# meeting-time-slot — 공용 회의시간 조회 (계명대학교 학생처)

여러 사람의 주간 시간표를 한 달력에 합쳐 회의 가능 시간을 조회하는 웹앱.

## 배포 (Cloudflare Workers 정적 자산)
    npx wrangler login      # 최초 1회
    npx wrangler deploy

## 주의
이 페이지는 Claude 아티팩트 환경의 기능(`claude.use('sample')`: 시간표 읽기, `claude.use('db')`: 공용 명단 저장)을 사용합니다.
Cloudflare에 그대로 올리면 두 기능이 없어 **시간표 파일 읽기와 공용 저장이 동작하지 않고**, 명단은 각자 브라우저에만 저장됩니다.
정상 동작에는 Worker API(Anthropic API 키 + D1/KV)가 필요합니다.
