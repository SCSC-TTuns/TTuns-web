# Mixpanel 개발 문서 (TTuns)

## 개요
- 목적: TTuns(서울대 강의실/교수 검색·시간표)에서 사용자 행동을 계측하여 검색/탐색 흐름과 기능 사용성을 개선합니다.
- 범위: 현재 저장소에 포함된 Mixpanel 설정과 유틸을 기준으로 초기화, 이벤트 트래킹 흐름, TrackedButton 사용법을 정리합니다.

## 환경 설정
- 패키지: `mixpanel-browser`(이미 `package.json`에 존재)
- 환경 변수: `NEXT_PUBLIC_MIXPANEL_TOKEN=<Mixpanel 프로젝트 토큰>`

## 코드 구성과 역할
- `src/lib/mixpanel/mixpanelClient.ts`
  - 역할: SDK 초기화(`initMixpanel`), 공통 트래킹(`track`), 준비 상태 확인(`isReady`).
  - 동작: 브라우저 전용(`'use client'`), `mixpanel.init(TOKEN, { track_pageview: false, ... })`로 수동 페이지뷰 정책. 초기화 완료 시 `getAnonymousId()`로 생성/보관된 익명 ID를 `mixpanel.identify`에 적용.
  - 실패 내성: 초기화/전송 실패 시 콘솔 로깅만 수행, 앱 흐름 차단하지 않음.

- `src/lib/mixpanel/trackEvent.ts`
  - 역할: 공통 이벤트 트래커(`trackEvent`)와 UI 전용 헬퍼(`trackUIEvent`).
  - 포함 함수: 
    - `trackUIEvent.buttonClick(button_type, targetUrl?)` → `button_click` 이벤트로 로깅.
    - `trackUIEvent.sidebarToggle(isOpen)` → `sidebar_toggle`(자동 `device_type` 포함).
    - `trackUIEvent.pageView(page, title)` → `page_view`(referrer/UA/해상도/뷰포트 포함).
  - 비고: `trackChatEvent`도 존재하나 TTuns UI에선 사용하지 않음(향후 확장용 헬퍼).

- `src/components/TrackedButton.tsx`
  - 역할: 버튼/링크 클릭을 자동으로 `button_click`으로 로깅하는 래퍼.
  - 동작: 클릭 시 `trackUIEvent.buttonClick(button_type, href)` 호출 후 전달된 `onClick` 실행. `href` 존재 시 Next.js `Link`, 없으면 `<button>` 렌더링.
  - 요구: `button_type`는 스키마 일관성을 위해 `snake_case` 권장.

- `src/lib/utils/anonymousId.ts`
  - 역할: `localStorage('anonymous_id')` 관리. 없으면 `anon_<랜덤>` 생성 후 보관.
  - 사용처: 초기화 완료 콜백에서 `mixpanel.identify`에 사용.

- `src/lib/mixpanel/mixpanel-browser.d.ts`
  - 역할: SDK 타입 보완(내부 플래그 확장). 기능 동작에는 영향 없음.

## 초기화와 정보 흐름
- 초기화(반드시 1회): 앱 진입점(클라이언트 경계)에서 `initMixpanel()` 호출이 필요합니다. 현재 저장소에는 전역 Provider가 없으므로, 루트 레이아웃(클라이언트 컴포넌트) 또는 페이지 마운트 시 초기화하세요.
- 페이지뷰 보고: SDK 기본 자동 페이지뷰가 꺼져 있으므로 각 페이지에서 `trackUIEvent.pageView(path, title)`를 수동 호출합니다.
- 이벤트 흐름(버튼 클릭 예):
  - 유저 클릭 → `TrackedButton.handleClick` → `trackUIEvent.buttonClick` → `track()` → `mixpanel.track()` → Mixpanel 수집.
  - 사용자 식별: `initMixpanel()` 내부에서 익명 ID 생성/식별 후 모든 이벤트에 동일 사용자 컨텍스트 적용.

## 사용법
- 초기화(예시)
  - 클라이언트 상위 컴포넌트에서 1회:
    - `import { initMixpanel } from '@/lib/mixpanel/mixpanelClient'`
    - 마운트 시 `initMixpanel()` 호출

- 페이지뷰(예시)
  - `import { trackUIEvent } from '@/lib/mixpanel/trackEvent'`
  - 마운트 시 `trackUIEvent.pageView('/snutt/timetable', 'TTuns Timetable')`

- TrackedButton(예시)
  - 검색 버튼 교체:
    - `import TrackedButton from '@/components/TrackedButton'`
    - `<TrackedButton button_type="timetable_search" onClick={onSearch} className="tt-primary">검색</TrackedButton>`
  - 링크 버튼:
    - `<TrackedButton href="/snutt/timetable" button_type="nav_timetable">시간표</TrackedButton>`

- 커스텀 이벤트(예시)
  - `import { trackEvent } from '@/lib/mixpanel/trackEvent'`
  - `trackEvent('search_performed', { mode, year, semester, query_len: q.length })`

## 이벤트 스키마(현 상태)
- 공통 제공
  - `button_click`: { `button_type`, `target_url?` }
  - `sidebar_toggle`: { `is_open`, `device_type` }
  - `page_view`: { `page`, `title`, `referrer`, `user_agent`, `screen_resolution`, `viewport_size` }

- 프로젝트 권장값(예)
  - 버튼 타입(`button_type`): `timetable_search`, `toggle_filter_collapse`, `free_room_copy`, `nav_timetable`
  - 커스텀: `search_performed`(추가 속성: `mode`, `year`, `semester`, `query_len`), `event_detail_opened`(추가 속성: `title`, `day`, `start`, `end`)

네이밍 가이드
- 이벤트/속성은 `snake_case` 유지(팀 컨벤션 일치).
- 버튼 타입은 동작+맥락 조합(예: `toggle_filter_collapse`).

## 운영/보안/성능
- 실패 허용: 초기화/전송 실패 시 콘솔 경고만 남기고 흐름 지속.
- 비블로킹: 트래킹은 UI 경로를 블로킹하지 않도록 설계.
- 개인정보: 익명 ID만 사용. 검색어 원문 등 민감한 텍스트는 전송하지 않고 길이/정규화 값만 사용 권장.

## 문제 해결
- 토큰 확인: `process.env.NEXT_PUBLIC_MIXPANEL_TOKEN`가 브라우저에서 주입되는지 확인.
- 준비 상태: `import { isReady } from '@/lib/mixpanel/mixpanelClient'` 후 `isReady()` 검사.
- 개발 디버깅: 개발 모드에서 `debug: true`가 활성화되어 콘솔에서 전송 로그 확인. Mixpanel Live View 병행.

## TODO
- 전역 초기화 추가: 루트 레이아웃(클라이언트) 또는 공용 Provider에서 `initMixpanel()` 1회 호출.
- 페이지뷰 계측: `/snutt/timetable` 마운트 시 `trackUIEvent.pageView` 호출 추가.
- 버튼 계측 적용: 검색/필터 토글/빈 강의실 복사 버튼에 `TrackedButton` 또는 수동 `button_click` 연동.
- 검색/상세 이벤트: `search_performed`/`event_detail_opened` 등 커스텀 이벤트 속성 정의 확정 후 코드 반영.
- 문서 동기화: 실제 적용된 `button_type`/속성 목록을 이 문서에 유지관리.
