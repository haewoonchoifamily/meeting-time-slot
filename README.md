# meeting-time-slot — 공용 회의시간 조회 (계명대학교 학생처)

여러 사람의 주간 시간표(엑셀·PDF·이미지)를 한 달력에 합쳐, 시간마다 이름을 보여주고 회의 가능 시간을 조회하는 웹앱.

- 조회 탭: 그룹/사람을 골라 합친 달력 보기 ("일정 있는 사람" / "가능한 사람")
- 설정 탭: 신규 명단 등록, 이름·일정 수정, 삭제, 그룹 관리 (같은 이름 업로드 시 대체/건너뛰기 확인)
- 명단/그룹 저장: Cloudflare D1 (같은 주소를 여는 모든 사람이 공유)
- 접속 암호는 기본적으로 **없음**(주소를 아는 사람은 누구나 사용). 필요하면 시크릿 `APP_PASSCODE`를 등록하면 그때부터 암호를 묻습니다.

## 시간표를 읽는 방법 (외부 API 키 불필요)
| 파일 | 처리 |
|---|---|
| 엑셀(.xlsx .xls .csv) | **코드로 직접 해석** (무료·즉시). 요일이 가로, 시간(또는 N교시)이 세로인 표, 또는 `요일/시작/종료/내용` 목록형을 인식합니다. 병합된 칸도 처리합니다. |
| 위 양식이 아닌 엑셀 | Workers AI(텍스트)로 해석 |
| 이미지·PDF | 브라우저에서 이미지로 바꿔 Workers AI(비전 모델)로 읽기. PDF는 앞 3쪽까지 |

- 엑셀 외에는 AI가 읽으므로 틀릴 수 있습니다. 읽은 뒤 설정 탭의 일정을 확인·수정하세요.
- "N교시"만 있고 시각이 없으면 1교시=09:00, 50분 수업+10분 휴식으로 가정합니다(등록 시 안내가 뜹니다).
- Workers AI는 계정당 하루 10,000 Neurons까지 무료이고, 초과 시 Workers Paid 플랜이 필요합니다.

## 구성
    public/index.html   화면 (정적)
    src/index.js        Worker: /api/people, /api/groups (D1), /api/extract (Workers AI)
    wrangler.jsonc      Worker 설정 (D1 바인딩 DB, AI 바인딩 AI)
    schema.sql          D1 테이블 (Worker가 처음 호출 때 자동 생성하므로 수동 실행은 선택)

## 배포
1. **배포**: GitHub 연결 배포는 `main`에 push할 때마다 자동. 직접 하려면 `npx wrangler login` 후 `npx wrangler deploy`
   (시크릿 등록은 필요 없습니다.)
2. **(선택) 접속 제한**: 주소를 아는 누구나 명단을 보고 바꿀 수 있고 AI 무료 사용량을 쓸 수 있습니다. 제한하려면 둘 중 하나를 쓰세요.
   - 접속 암호: 대시보드 → Worker → Settings → Variables and Secrets에 `APP_PASSCODE`(Secret) 등록 (또는 `npx wrangler secret put APP_PASSCODE`)
   - Cloudflare Access: Zero Trust에서 이 Worker 주소를 학교 이메일 로그인으로 보호 (코드 변경 없음)
3. 다른 Cloudflare 계정에 올리는 경우: `npx wrangler d1 create meeting-time-slot` 후 나온 `database_id`를 `wrangler.jsonc`에 넣습니다.


## 로컬 실행
    cp .dev.vars.example .dev.vars   # 값 채우기
    npx wrangler dev                 # AI 바인딩은 원격(Cloudflare 로그인 필요)으로 동작

## 참고
- 사용 모델은 `wrangler.jsonc`의 `vars.TEXT_MODEL`, `vars.VISION_MODEL`로 바꿀 수 있습니다.
