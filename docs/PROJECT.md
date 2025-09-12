**TTuns 프로젝트 개요**
- 목적: 서울대학교 강의 데이터(SNUTT)를 활용해 교수님/강의실별 시간표와, 특정 동(building) 기준으로 현재 빈 강의실을 빠르게 조회하는 Next.js 웹 서비스.
- 대상: 빠르게 강의실/교수님 시간대를 확인하려는 학생·교직원.
- 핵심 기능
  - 교수명 검색 → 동명이인 처리(소속 단위 그룹핑) 후 해당 교수의 주간 시간표 표시
  - 강의실 검색 → 해당 강의실이 잡힌 전체 강좌 일정 표시
  - 빈 강의실 검색 → 동 번호(예: 301)와 현재 시각(KST)을 기준으로 현재 비어 있고 다음 점유 전까지의 남은 시간 계산·표시

**전체 구조**
- 기술 스택: Next.js 15(App Router), React 19, TypeScript 5, ESLint(Flat config), Zod(현재 코드에서 직접 사용 없음), Axios(직접 사용 없음; fetch 사용)
- 배치/실행: Vercel 기준 설정 포함. 런타임은 API 라우트별 `runtime = "nodejs"` 고정.
- 디렉터리
  - `src/app/snutt/timetable/page.tsx` + `page.css`: 클라이언트 UI(검색/표시/상세 모달/반응형 레이아웃)
  - `src/app/api/snutt/search/route.ts`: 학기별 슬림 강의 목록 프록시 API
  - `src/app/api/snutt/free-rooms/route.ts`: 빈 강의실 조회 API
  - `src/server/snutt.ts`: SNUTT 연동 로직, 멀티페이지 페치, 전역 캐시/레이트 리미트/유틸
  - `src/lib/lectureSchedule.ts`: 시간표 이벤트 구성, 겹침 레이아웃, 기본 시간 범위 계산, 교수/강의실 완전일치 매칭 도우미
  - `src/lib/lectureUtils.ts`: 유사 매칭/초성 검색·강의실 후보 추출(현재 UI 직접 사용 안 함; 향후 확장용)
  - 루트 설정: `next.config.ts`, `eslint.config.mjs`, `tsconfig.json`

**아키텍처 계층 구조도**

```mermaid
graph TD
  %% Client Layer
  subgraph Client[Client (Next.js App Router)]
    UI[page.tsx: TimetablePage (use client)]
    CSS[page.css]
    LIB[lib/lectureSchedule.ts]
    UI -- layout/buildEvents --> LIB
    UI <--> CSS
  end

  %% API Layer
  subgraph API[API Routes]
    S[/api/snutt/search (GET/POST)/]
    F[/api/snutt/free-rooms (GET)/]
  end

  %% Server/Service Layer
  subgraph Service[src/server/snutt.ts]
    G[getSlimLectures(year, semester)]
    U1[canonicalSemesterId / semesterVariantsByCanonical]
    U2[fetchAllPagesSlim + callSnutt]
    C1[(__snuttCache)]
    C2[(__snuttInflight)]
    R[(__snuttRate)]
    FR[(__freeRoomsCache)]
  end

  %% Upstream
  subgraph Upstream[SNUTT API]
    SNUTT[(POST /v1/search_query)]
  end

  %% Flows
  UI -- fetch lectures --> S
  UI -- fetch free rooms --> F
  S --> R
  F --> R
  S --> G
  F --> G
  F --> FR
  G --> U1
  G --> C1
  G --> C2
  G -- on MISS --> U2
  U2 --> SNUTT
```

ASCII 개요(텍스트 뷰어용)

```
Client (page.tsx, page.css)
  └─ uses lib/lectureSchedule.ts for event build/layout
       │
       ├─ calls /api/snutt/search (학기 강의 목록)
       └─ calls /api/snutt/free-rooms (빈 강의실)

API Routes
  /api/snutt/search  → rate-limit → getSlimLectures → cache/coalesce → (fetchAllPagesSlim → SNUTT) → LectureSlim[]
  /api/snutt/free-rooms → rate-limit → getSlimLectures → 당일 점유 계산 → freeRoomsCache(60s) → FreeRoom[]

Service (src/server/snutt.ts)
  - getSlimLectures: __snuttCache(30m), __snuttInflight, semester normalization, multi-pagination fallback
  - freeRoomsCache: 5분 슬롯 키, 60초 TTL
  - take(ip): rate limit buckets
  - callSnutt: POST /v1/search_query

Upstream: SNUTT API (/v1/search_query)
```

**런타임/설정 정책**
- `next.config.ts`
  - `eslint.ignoreDuringBuilds: process.env.VERCEL === "1" 일 때 true` → Vercel 빌드 실패 방지
  - `typescript.ignoreBuildErrors: process.env.IGNORE_TS_ERRORS === "1"` → 긴급시 타입 에러 무시 가능(기본은 엄격)
  - `experimental.typedRoutes: true`
- `eslint.config.mjs`: Next.js + TypeScript 권장 설정 적용, 산출물/빌드 폴더 ignore
- `tsconfig.json`: `paths: { "@/*": ["./src/*"] }` 별칭 사용

**환경 변수**
- SNUTT 연동
  - `SNUTT_API_BASE`(선택, 기본 `https://snutt-api.wafflestudio.com`)
  - `SNUTT_API_KEY`(필수)
  - `SNUTT_ACCESS_TOKEN`(필수)
- 캐시/레이트 리밋 조정
  - `SNUTT_CACHE_TTL_SECONDS`(강의 목록 캐시 TTL, 기본 1800초)
  - `SNUTT_RATE_LIMIT_WINDOW_MS`(IP별 윈도우, 기본 60000ms)
  - `SNUTT_RATE_LIMIT_MAX`(윈도우 내 최대 요청, 기본 30)

**데이터 모델(서버 내부 표준화)**
- LectureRaw: SNUTT 응답 원본. 필드 명/형식이 변동 가능하며, 안전하게 파싱.
- LectureSlim: 클라이언트에 반환하는 슬림 모델
  - `course_title: string`
  - `instructor: string`
  - `class_time_json: { day, startMinute|start_time|start/len, endMinute|end_time }[]`
  - `course_number: string`, `lecture_number: string`
  - `department: string`(소속 필드 보강)
  - `year?: number`, `semester?: number|string`
- FreeRoom: `{ room: string; until: number /* 분 */ }`

**서버 계층 설계(src/server/snutt.ts)**
- 전역 저장소(Global cache on Node runtime)
  - `__snuttCache`: 학기별(LectureSlim[]) 캐시. key: `${base}::${year}::${canonSem}`
  - `__snuttInflight`: 동일 키 동시 요청 병합(코얼레스). 중복 페치 방지
  - `__snuttRate`: IP 버킷 레이트 리미팅(윈도우·카운트)
  - `__freeRoomsCache`: 5분 슬롯 단위의 빈 강의실 계산 결과 캐시(짧은 TTL)
- 레이트 리미팅
  - `take(ip)`: 윈도우 내 요청 횟수 증가/초과 차단. 초과 시 429 응답 유도
- SNUTT 페치
  - `callSnutt(body, base, apiKey, accessToken)`: `/v1/search_query` POST 호출. content-type이 JSON이면 파싱, 아니면 원문 유지
  - 학기 표준화
    - `canonicalSemesterId(sem)`: 1/2/3/4, 여름=S→2, 겨울=W→4, 2학기=3 등 변환
    - `semesterVariantsByCanonical(canon)`: 동치인 값 배열(문자/숫자·시즌 코드)로 재시도
  - 다중 페이지 안전 수집: `fetchAllPagesSlim(...)`
    - 1) `limit+offset` 페이지네이션 루프
    - 2) 필요 시 `page` 기반 루프를 보조 시도(서버 구현 차이 대비)
    - 3) `keyOf(...)`로 de-dup 후 Slim 변환
- 최종 진입점: `getSlimLectures(year, semester)`
  - 캐시 HIT 시 즉시 반환, in-flight가 있으면 coalesce, MISS 시 페치 → 캐시 기록
  - 에러는 상위에서 502로 매핑
- 공통 응답: `jsonError(message, status)`
- 시간 유틸: `nowKst()` → JS 일요일(0)→SNUTT 월(0) 기준 매핑, 분 단위 시각 반환

**API 레이어(src/app/api)**
- `/api/snutt/search` (GET/POST)
  - 입력: `year`(number), `semester`(string: 1|2|3|4|S|W 등)
  - 처리: IP 레이트 리밋 → `getSlimLectures` → `LectureSlim[]` 반환
  - 헤더: `x-cache: HIT|COALESCE|MISS`, `Cache-Control: public, max-age=0, s-maxage=1800, stale-while-revalidate=86400`
  - 에러: 400(입력 오류), 429(과다 요청), 502(업스트림 오류)
- `/api/snutt/free-rooms` (GET)
  - 입력: `year`, `semester`, `building`(예: 301), `day?`(0=월…6=일), `at?`("HH:mm")
  - 처리 흐름
    1) 레이트 리밋 검사
    2) 현재 시각/요일(KST) 또는 `day/at`를 기준으로 계산 시각 결정
    3) 캐시 키: `free:${year}:${canonicalSemester}:${building}:${day}:${minuteSlot}` (minuteSlot=5분 단위)
    4) MISS 시: 해당 학기 모든 강의 시간 블록 중, `building-XXX`로 시작하는 모든 방의 당일 점유 구간을 수집·정렬
       - SNUTT 시간 표현은 다양 → `toMinuteRange`로 `startMinute/endMinute`, `start_time/end_time`, `start+len`를 모두 수용
    5) 현재 `minute`에 점유되지 않은 방만 채택하고, 다음 점유 시작 전까지의 분(`until`) 결정(없으면 24:00)
    6) 방 이름은 하이픈 뒤 숫자 기준으로 자연 정렬(`Collator` numeric)
    7) 짧은 TTL(60초)로 캐시
  - 헤더: `x-cache: HIT|MISS`, `Cache-Control: public, max-age=30, s-maxage=60`
  - 에러: 400(입력 오류), 429(과다 요청), 502(업스트림 오류)

**클라이언트(UI) 설계(src/app/snutt/timetable/page.tsx)**
- 모드: `"professor" | "room" | "free"`
- 핵심 상태
  - `year`, `semester`(기본 2025, 3)
  - `mode`, `q`(검색어), `loading`
  - `events: EventBlock[]`(시간표 표시용), `activeLectures: AnyLecture[]`(이벤트 매칭 후보)
  - `freeRooms: { room; until }[]`(빈 강의실 결과)
  - 동명이인 케이스: `profFiltered`, `deptOptions`, `dept`, `deptInclude`
  - UI: 접힘 상태(`collapsed`), 패널 높이(`panelMaxH`), `PPM`(pixels-per-minute; 반응형 계산)
  - 상세 선택: `sel: { ev; lec? }`(모달 표시)
- 사전 프리페치: `year/semester` 변경 시 `/api/snutt/search` 미리 호출(UX 개선)
- 검색 흐름
  - 빈 강의실 모드(`free`)
    - 현재(KST)의 요일/시각과 입력 `building`으로 `/api/snutt/free-rooms` 호출
    - 결과를 카드 리스트로 렌더링(방이름, `~ HH:mm` 까지 빈 시간, 복사 버튼)
  - 교수/강의실 모드
    - 세션 캐시(브라우저 메모리)로 `year-semester` 키로 강의 목록 캐시
    - 교수 모드
      - 완전일치(공백만 무시) 교수명 필터 → 후보 강의 모음
      - 후보들의 `department`를 수집해 소속 선택 UX 제공
        - `연계|연합|협동` 포함 소속은 동명이인 조합으로 묶음
        - 기본 소속이 하나면 자동 선택(collapsed), 여러 개면 드롭다운 노출
      - 확정된 소속 기준으로 시간표 이벤트 구성
    - 강의실 모드
      - 완전일치(공백만 무시) 강의실 필터 → 시간표 이벤트 구성
- 시간표 구성/레이아웃(`src/lib/lectureSchedule.ts` 사용)
  - `buildEventsFromLectures` → `TimetableEvent[]` 생성(요일/분 범위/제목/교수/강의실/학수·분반)
  - `layoutByDay` → 겹침 해소: 각 요일별로 lane 할당 후 `col/colCount` 부여
  - `timeBounds` → 표시 시간대의 상·하한 산출(기본 08:00~22:00, 이벤트 없으면 기본값)
  - 렌더링 시 `PPM`(pixels-per-minute)로 높이 계산, 모바일에서 화면 높이에 맞춰 동적으로 조정
  - 색상: 강의명 해시→HSL 기반으로 반복성 없는 색 분산
- 접근성/UX
  - 패널 접힘/펼침 토글, 키보드 Enter로 검색, Escape로 모달 닫기
  - 버튼/세그먼트 aria 속성, 스크린리더 텍스트(`sr-only`)
  - 모바일 최적화: 요약 pill bar, 폰트/간격 축소, 이벤트 2줄까지 표시, 축 레이블 조정

**스타일(page.css) 개요**
- CSS 전역 변수로 색/간격 정의, 컴포넌트 단위 BEM 유사 네이밍(`tt-*`)
- 주요 블록
  - 헤더/필터 패널: 접힘 애니메이션(`max-height`/`opacity` 트랜지션), 요약 pill bar
  - 세그먼트 토글/검색 버튼: 동일 높이 변수(`--ctl-h`)로 정렬
  - 빈 강의실 카드 리스트: 그리드, hover/elevation, "복사됨" 피드백
  - 시간표 그리드: 시간 축/시간선/이벤트 카드, 겹침을 `col/colCount`로 계산된 width/left 적용
  - 상세 모달: 오버레이+카드, 전체 일정 목록

**강의/시간 처리 유틸(lib)**
- `lectureSchedule.ts`(UI에서 사용)
  - `extractProfessor(lec)`: `instructor` 또는 `instructors[]` 결합
  - `allRooms(lec)`: 상위 필드(`place|room|location`) 및 `class_time_json[].place` 후보 수집
  - `lectureMatchesProfessorExact`: 엄격 비교(양끝 공백만 무시)
  - `lectureMatchesRoomExact`: 후보 중 하나가 엄격 일치
  - `buildEventsFromLectures`: `class_time_json`을 `TimetableEvent`로 변환, 제목/교수/방/학수·분반
  - `layoutByDay`: 하루 단위 lane 배치로 이벤트 겹침 해소
  - `timeBounds`: 표시 구간 상·하한 계산(기본 08:00~22:00)
- `lectureUtils.ts`(확장용 도구 모음; 현재 페이지에 직접 사용하지 않음)
  - `norm(...)`: 공백/특수기호 제거+소문자 정규화
  - 초성 검색(`toChosung`) 지원으로 한글 교수명 부분/완전 일치 강화
  - `profMatches`, `roomMatches`, `bestRoomForQuery`: 유사/부분 일치 탐색과 최적 표시용 후보 선택
  - `allRooms`: 후보 방 수집(동일 로직)

**오류 처리/캐싱/성능**
- API 공통
  - Bad input → 400, Rate limit 초과 → 429, 업스트림(SNUTT) 문제 → 502
  - `x-cache` 헤더로 캐시 상태 노출(HIT/COALESCE/MISS)
  - `Cache-Control`은 s-maxage를 통해 CDN 캐싱을 허용, 클라 캐싱은 낮게 유지
- 서버 메모리 캐시(global)
  - 학기 강의 목록: TTL(기본 30분)
  - `free-rooms` 결과: 5분 슬롯 키로 60초 유지(동일 시각대 반복 요청 최적화)
  - in-flight 합치기(coalescing)로 첫 페치 완료까지 중복 호출 제거
- 클라이언트 메모리 캐시
  - 브라우저 세션 내 `year-semester` 키로 전체 강의 배열 캐시
- 반응형 렌더링
  - 모바일 화면 높이에 따라 `PPM` 동적 조정 → 일정 가독성 유지

**개발/로컬 실행 가이드**
- 사전 준비: `.env.local` 설정
  - 예시
    - `SNUTT_API_BASE=https://snutt-api.wafflestudio.com`
    - `SNUTT_API_KEY=...`
    - `SNUTT_ACCESS_TOKEN=...`
    - 선택: `SNUTT_CACHE_TTL_SECONDS=1800`
    - 선택: `SNUTT_RATE_LIMIT_WINDOW_MS=60000`
    - 선택: `SNUTT_RATE_LIMIT_MAX=30`
- 실행
  - `npm run dev` → `http://localhost:3000`
  - 페이지 경로: `/snutt/timetable`
- 유효성 체크(수동)
  - `/api/snutt/search?year=2025&semester=3` → `LectureSlim[]` 확인
  - `/api/snutt/free-rooms?year=2025&semester=3&building=301` → 빈 강의실 리스트 확인
  - UI에서 교수명/강의실/동번호 각각 검색 시 렌더링과 모달/복사 기능 동작 확인

**확장/변경 지침**
- 검색 고도화
  - `lectureUtils.ts` 내 유사/초성 검색을 UI에 통합해 부분 일치 검색 UX 개선 가능
  - 현재는 교수/강의실 모두 "완전 일치(양끝 공백만 무시)" 대상만 필터
- 데이터 스키마 변화 대응
  - SNUTT 응답의 시간 표현 다양성은 `toMinuteRange`/슬림화 로직이 수용 중
  - 추가 필드(예: 강의 언어, 수강정원 등) 노출 시 `LectureSlim` 확장 및 모달 렌더링 확장
- 캐시/성능
  - 캐시 TTL/레이트 정책은 환경 변수로 조정. 트래픽 증가 시 s-maxage 상향, `free-rooms` TTL 보정
  - 장기적으로 KV/Redis 캐시로 이전하면 서버리스 콜드스타트/수명에 덜 영향받음
- 접근성/국제화
  - 현재 한글 라벨/요일. i18n 적용 시 라벨/요일 포맷 분리 필요
  - 키보드 탐색/포커스 스타일 확장 고려

**보안/운영 고려**
- SNUTT 자격증명은 서버에서만 사용. 클라이언트로 노출 금지
- API Rate Limit은 기본적 방어. WAF/CDN 레벨 규칙 병행 권장
- 장애 처리: 업스트림 실패시 502. 필요 시 재시도/백오프/대체 캐시 레이어 검토

**요약: 주요 흐름 정리**
- Service: `getSlimLectures`가 학기 단위 강의 전체를 안정적으로 수집(변형된 페이징 호환), 전역 캐시/병합으로 부하 최소화
- API: `/api/snutt/search`가 슬림 강의 배열을, `/api/snutt/free-rooms`가 시점 기반 빈 강의실 목록을 제공
- UI: 모드별 검색 → 이벤트 구축(`lectureSchedule.ts`) → 겹침 해소 레이아웃 → 카드/그리드 렌더링, 상세 모달로 원본 맥락 제공
