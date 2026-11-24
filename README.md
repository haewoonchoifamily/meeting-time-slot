# meeting-time-slot — 공용 회의시간 조회 (계명대학교 학생처)

여러 사람의 주간 시간표(엑셀·PDF·이미지)를 한 달력에 합쳐, 시간마다 이름을 보여주고 회의 가능 시간을 조회하는 웹앱.

- 조회 탭: 그룹/사람을 골라 합친 달력 보기 ("일정 있는 사람" / "가능한 사람")
- 설정 탭: 신규 명단 등록, 이름·일정 수정, 삭제, 그룹 관리 (같은 이름 업로드 시 대체/건너뛰기 확인)
- 시간표 읽기: Worker가 Anthropic API(Claude)로 처리
- 명단/그룹 저장: Cloudflare D1 (같은 주소를 여는 모든 사람이 공유)
- 접속 암호(`APP_PASSCODE`)를 아는 사람만 사용 가능

## 구성
    public/index.html   화면 (정적)
    src/index.js        Worker: /api/people, /api/groups, /api/extract
    wrangler.jsonc      Worker 설정 (D1 바인딩 DB)
    schema.sql          D1 테이블 (Worker가 처음 호출 때 자동 생성하므로 수동 실행은 선택)

## 배포
1. **시크릿 2개 등록** (Cloudflare 대시보드 → Workers & Pages → meeting-time-slot → Settings → Variables and Secrets, 유형은 *Secret*)
   - `ANTHROPIC_API_KEY` : Anthropic API 키
   - `APP_PASSCODE` : 팀이 함께 쓸 접속 암호
   또는 터미널에서 `npx wrangler secret put ANTHROPIC_API_KEY`, `npx wrangler secret put APP_PASSCODE`
2. **배포**: `npx wrangler login` 후 `npx wrangler deploy`
   (GitHub 연결 배포를 쓰면 `main`에 push할 때마다 자동 배포. 시크릿은 유지됩니다.)
3. 다른 Cloudflare 계정에 올리는 경우: `npx wrangler d1 create meeting-time-slot` 후 나온 `database_id`를 `wrangler.jsonc`에 넣습니다.

시크릿이 없으면 `/api`가 "설정되어 있지 않습니다" 오류를 돌려줍니다 (암호 없이 열리지 않도록 닫힌 상태가 기본).

## 로컬 실행
    cp .dev.vars.example .dev.vars   # 값 채우기
    npx wrangler dev

## 참고
- 모델은 `wrangler.jsonc`의 `vars.MODEL`로 바꿀 수 있습니다.
- 이미지·PDF 읽기는 Anthropic API 사용량(요금)이 발생합니다. 암호를 아는 사람만 호출할 수 있습니다.
