// 공용 회의시간 조회 (계명대학교 학생처) — Cloudflare Worker
// 정적 페이지(public/)는 ASSETS가 서비스하고, /api/* 만 이 Worker가 처리합니다.
// 필요한 시크릿: ANTHROPIC_API_KEY, APP_PASSCODE  /  바인딩: DB(D1)

const KINDS = ['people', 'groups'];
const MAX_DOC_BYTES = 300_000;
const MAX_EXTRACT_BYTES = 24_000_000;

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const fail = (status, error) => json({ error }, status);

async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
async function passcodeOk(req, env) {
  const [a, b] = await Promise.all([sha256(req.headers.get('x-passcode') || ''), sha256(env.APP_PASSCODE)]);
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

let schemaReady = null;
function ensureSchema(env) {
  schemaReady ??= env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS docs (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (kind, id))'
  ).run().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
function validDoc(kind, id, d) {
  if (!d || typeof d !== 'object' || d.id !== id || !str(d.name, 100)) return false;
  if (kind === 'people') {
    return Array.isArray(d.events) && d.events.length <= 500 &&
      d.events.every((e) => e && Number.isInteger(e.day) && e.day >= 0 && e.day <= 6 &&
        /^\d{2}:\d{2}$/.test(e.start) && /^\d{2}:\d{2}$/.test(e.end) && typeof e.label === 'string' && e.label.length <= 200);
  }
  return Array.isArray(d.members) && d.members.length <= 2000 && d.members.every((m) => str(m, 64));
}

const PROMPT = (text) => `아래는 한 사람의 "주간 시간표"입니다. 요일별로 일정(수업·회의·근무·약속 등)이 있는 시간대를 모두 추출하세요.
규칙:
- 요일은 0=월,1=화,2=수,3=목,4=금,5=토,6=일 숫자.
- 시간은 24시간제 "HH:MM". 교시만 있고 시각이 없으면 표에 적힌 교시별 시각을 따르고, 시각 정보가 전혀 없으면 1교시=09:00부터 50분 수업+10분 휴식으로 가정하세요.
- 연속된 같은 일정은 하나로 합치고, label은 과목/일정명(짧게, 없으면 "")으로 하세요.
- 비어 있는 칸은 일정이 아닙니다. 표에 없는 내용을 지어내지 마세요.
- 출력은 JSON 배열만(설명·코드블록 없이). 예: [{"day":0,"start":"09:00","end":"10:15","label":"용접공학"}]
${text ? '\n[시간표 데이터(엑셀 변환, 병합셀은 채워서 표시)]\n' + text : '\n(첨부된 이미지/PDF 참고)'}`;

const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : null; };
const fmt = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');

function parseEvents(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a < 0 || b < a) throw new Error('결과를 해석하지 못했습니다.');
  const arr = JSON.parse(t.slice(a, b + 1));
  if (!Array.isArray(arr)) throw new Error('결과를 해석하지 못했습니다.');
  return arr
    .map((e) => ({
      day: Math.max(0, Math.min(6, parseInt(e.day) || 0)),
      start: fmt(toMin(e.start) ?? 0),
      end: fmt(toMin(e.end) ?? 0),
      label: String(e.label || '').slice(0, 200),
    }))
    .filter((e) => toMin(e.end) > toMin(e.start))
    .slice(0, 500);
}

async function extract(req, env) {
  if (!env.ANTHROPIC_API_KEY) return fail(503, '서버에 ANTHROPIC_API_KEY 시크릿이 설정되어 있지 않습니다.');
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_EXTRACT_BYTES) return fail(413, '파일이 너무 큽니다 (최대 약 24MB).');
  let body;
  try { body = await req.json(); } catch { return fail(400, '잘못된 요청입니다.'); }
  const text = typeof body.text === 'string' ? body.text.slice(0, 60000) : '';
  const files = Array.isArray(body.files) ? body.files.slice(0, 6) : [];
  const content = [];
  for (const f of files) {
    if (!f || typeof f.b64 !== 'string') continue;
    if (f.mime === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.b64 } });
    else if (/^image\/(png|jpeg|gif|webp)$/.test(f.mime)) content.push({ type: 'image', source: { type: 'base64', media_type: f.mime, data: f.b64 } });
  }
  if (!text && !content.length) return fail(400, '읽을 내용이 없습니다.');
  content.push({ type: 'text', text: PROMPT(text) });

  const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const r = await fetch(base + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.MODEL || 'claude-sonnet-5-5', max_tokens: 8000, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) {
    let m = '';
    try { m = (await r.json()).error?.message || ''; } catch {}
    return fail(502, `Claude 호출 실패 (${r.status}) ${m}`.trim());
  }
  const data = await r.json();
  const out = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  try { return json({ events: parseEvents(out) }); } catch (e) { return fail(502, e.message); }
}

async function handleApi(req, env, url) {
  if (!env.APP_PASSCODE) return fail(503, '서버에 APP_PASSCODE 시크릿이 설정되어 있지 않습니다.');
  if (!(await passcodeOk(req, env))) return fail(401, '암호가 필요합니다.');
  const parts = url.pathname.split('/').filter(Boolean); // ['api', kind, id?]
  if (parts[1] === 'ping' && req.method === 'GET') return json({ ok: true });
  if (parts[1] === 'extract' && req.method === 'POST') return extract(req, env);
  const kind = parts[1], id = parts[2];
  if (!KINDS.includes(kind)) return fail(404, '없는 경로입니다.');
  await ensureSchema(env);
  if (req.method === 'GET' && !id) {
    const { results } = await env.DB.prepare('SELECT data FROM docs WHERE kind = ?').bind(kind).all();
    return json(results.map((r) => JSON.parse(r.data)));
  }
  if (!str(id, 64)) return fail(400, '잘못된 id입니다.');
  if (req.method === 'PUT') {
    const raw = await req.text();
    if (raw.length > MAX_DOC_BYTES) return fail(413, '데이터가 너무 큽니다.');
    let d; try { d = JSON.parse(raw); } catch { return fail(400, '잘못된 JSON입니다.'); }
    if (!validDoc(kind, id, d)) return fail(400, '데이터 형식이 올바르지 않습니다.');
    await env.DB.prepare(
      'INSERT INTO docs (kind, id, data, updated) VALUES (?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, updated = excluded.updated'
    ).bind(kind, id, JSON.stringify(d), Date.now()).run();
    return json({ ok: true });
  }
  if (req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM docs WHERE kind = ? AND id = ?').bind(kind, id).run();
    return json({ ok: true });
  }
  return fail(405, '허용되지 않는 메서드입니다.');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(req, env, url); }
      catch (e) { return fail(500, '서버 오류: ' + (e && e.message || e)); }
    }
    return env.ASSETS.fetch(req);
  },
};
