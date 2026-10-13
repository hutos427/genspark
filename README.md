# FitLife – 운동·식단·수면 통합 건강관리 웹앱

## 개요
모바일 우선 SPA. 로그인 후 하단 탭 4개(홈 / 헬스 / 수면 / 내정보)로 건강 데이터를 기록하고 분석합니다.

## 완료된 기능
- **초기화면**: 로그인(아이디/비밀번호), 회원가입, 아이디 찾기(이름+이메일, 마스킹 표시), 비밀번호 찾기(아이디+이메일 → 임시 비밀번호 발급)
- **홈**: 월간 캘린더(일정/운동/수면/식단 기록 도트 표시, 날짜 선택), 선택일 일정(추가·완료·삭제), 수면시간, 운동기록(MET 기반 칼로리 자동계산), 식단 칼로리(끼니별), 구간별 통계 그래프(1주/1개월/3개월/1년 × 운동량·운동시간·신체정보)
- **📸 AI 사진 칼로리 측정**: 음식 사진 촬영/업로드 → GPT 비전 모델(gpt-5-mini)이 음식별 양·칼로리·탄단지 추정 → 항목 선택/칼로리 수정 → 날짜·끼니 지정 후 식단에 기록 (썸네일 + AI 뱃지 저장). 헬스>식단 탭 및 홈 식단 카드에서 사용
- **헬스**: AI 운동가이드(인바디·최근 운동량·수면 분석 리포트 + 목표/레벨별 주간 루틴 + 권장 영양), 식단(끼니별 기록, 빠른 음식 선택, 탄단지 차트), 장기 목표(D-day, 진행률), 월별 목표(월 실적 자동 집계)
- **수면**: 원터치 취침/기상 타이머, 수면시간 체크(자정 넘김 자동 계산), 수면상태 체크(만족도 별점, 상태 태그, 메모), 2주 그래프·평균
- **내정보**: 개인정보 수정, 비밀번호 변경, 인바디 갱신(BMI/체지방률 자동 계산) 및 이력

## API (모두 JSON, `/api/auth/*` 외에는 세션 쿠키 필요)
| 경로 | 설명 |
|---|---|
| POST `/api/auth/signup` `login` `logout` `find-id` `reset-password` | 인증 |
| GET/PUT `/api/me`, PUT `/api/me/password` | 내 정보 |
| GET/POST/PUT/DELETE `/api/{schedules,sleep,workouts,meals,inbody,goals}` | CRUD (`?from=&to=`, goals: `?kind=&month=`) |
| POST `/api/meals/analyze` `{image: dataURL, hint?}` | AI 음식 사진 칼로리 분석 |
| GET `/api/summary?date=YYYY-MM-DD` | 홈 일별 요약 + 월 캘린더 마크 |
| GET `/api/stats?days=7` | 기간 통계 |
| GET `/api/ai-guide?goal=diet|muscle|health&level=beginner|intermediate|advanced` | AI 운동 가이드 |

## 데이터 구조 (Cloudflare D1)
- **DB**: Cloudflare D1 (SQLite 기반), 테이블 8개
- **스크립트**: `migrations/0001_init.sql`(기본 테이블), `migrations/0002_meal_photo.sql`(AI 사진용 컬럼 추가)

### 관계도 (ERD)
```mermaid
erDiagram
    users ||--o{ sessions : "로그인"
    users ||--o{ schedules : "일정"
    users ||--o{ sleep_logs : "수면"
    users ||--o{ workouts : "운동"
    users ||--o{ meals : "식단"
    users ||--o{ inbody : "인바디"
    users ||--o{ goals : "목표"

    users {
        INTEGER id PK
        TEXT username UK "아이디"
        TEXT password_hash "암호화된 비밀번호"
        TEXT salt
        TEXT name "이름"
        TEXT email "이메일"
        TEXT phone "휴대폰"
        TEXT birth "생년월일"
        TEXT gender "M/F"
        REAL height "키(cm)"
        DATETIME created_at "가입일"
    }
    sessions {
        TEXT token PK "로그인 토큰"
        INTEGER user_id FK
        INTEGER expires_at "만료(30일)"
    }
    schedules {
        INTEGER id PK
        INTEGER user_id FK
        TEXT date "날짜"
        TEXT time "시간"
        TEXT title "제목"
        TEXT memo "메모"
        INTEGER done "완료 0/1"
    }
    sleep_logs {
        INTEGER id PK
        INTEGER user_id FK
        TEXT date "기상일"
        TEXT bed_time "취침"
        TEXT wake_time "기상"
        INTEGER duration_min "수면(분)"
        INTEGER quality "만족도 1~5"
        TEXT states "상태 태그"
        TEXT memo
    }
    workouts {
        INTEGER id PK
        INTEGER user_id FK
        TEXT date
        TEXT type "운동 종류"
        INTEGER duration_min "운동(분)"
        INTEGER calories "소모 kcal"
        TEXT intensity "강도"
        TEXT memo
    }
    meals {
        INTEGER id PK
        INTEGER user_id FK
        TEXT date
        TEXT meal_type "아침/점심/저녁/간식"
        TEXT food "음식명"
        INTEGER calories "kcal"
        REAL carbs "탄수(g)"
        REAL protein "단백질(g)"
        REAL fat "지방(g)"
        TEXT photo "사진(AI)"
        INTEGER ai "AI 분석 여부"
    }
    inbody {
        INTEGER id PK
        INTEGER user_id FK
        TEXT date "측정일"
        REAL weight "체중"
        REAL muscle "골격근량"
        REAL fat_mass "체지방량"
        REAL fat_pct "체지방률"
        REAL bmi
        INTEGER bmr "기초대사량"
    }
    goals {
        INTEGER id PK
        INTEGER user_id FK
        TEXT kind "long/monthly"
        TEXT month "월별 목표의 달"
        TEXT deadline "장기 목표 기한"
        TEXT title "목표명"
        REAL target "목표값"
        REAL current "현재값"
        TEXT unit "단위"
        INTEGER done "달성 여부"
    }
```

### 테이블과 사용 화면
| 테이블 | 용도 | 사용 화면 |
|---|---|---|
| `users` | 회원 정보 | 로그인, 회원가입, 아이디/비밀번호 찾기, 내정보 |
| `sessions` | 로그인 상태 유지 | 전체 |
| `schedules` | 일정 | 홈 (달력, 일정) |
| `sleep_logs` | 수면 시간과 상태 | 수면 탭, 홈 |
| `workouts` | 운동 기록 | 홈 (운동 기록, 통계), AI 운동가이드 |
| `meals` | 식단, AI 사진 분석 결과 | 헬스 > 식단, 홈 |
| `inbody` | 신체 정보 | 내정보 > 인바디, 홈 통계(신체정보) |
| `goals` | 장기 / 월별 목표 | 헬스 > 장기·월별 목표 |

### 설계 내용
- 회원 1명 : 기록 여러 개 구조. 모든 기록은 `user_id`로 회원과 연결되며, 서버에서 본인 데이터만 접근하도록 제한합니다.
- 비밀번호는 PBKDF2-SHA256(10만 회) + salt 해시로만 저장하고, 세션은 HttpOnly 쿠키(30일)입니다.
- 각 기록 테이블에 `(user_id, date)` 인덱스, `goals`에 `(user_id, kind)` 인덱스가 있습니다.
- `goals`는 `kind` 값으로 장기 목표와 월별 목표를 함께 관리합니다.

## 분석 산출물
- `docs/FitLife_분석산출물.xlsx` — 요구사항정의서, 기능정의서, 유스케이스 명세, 화면목록, 테이블목록/정의서, 인덱스정의서, API정의서, 업무규칙, 메시지정의서, 요구사항추적표 (11종)
- `docs/generate_analysis_docs.py` — 산출물 생성 스크립트

## 환경 변수 (시크릿)
- `OPENAI_API_KEY`, `OPENAI_BASE_URL` — 로컬은 `.dev.vars`(git 제외), 프로덕션은 `wrangler pages secret put`

## 미구현 / 다음 단계
- AI 가이드는 현재 규칙 기반 개인화 → OpenAI 등 LLM API 연동 가능
- 이메일 인증 기반 비밀번호 재설정(현재는 화면에 임시 비밀번호 표시)
- 웨어러블/건강앱 연동, 푸시 알림, 음식 DB 검색
- 프로덕션 배포(Cloudflare D1 생성 후 `database_id` 교체)

## 로컬 실행
```
npm run build && npm run db:migrate:local && pm2 start ecosystem.config.cjs
```
- **Tech**: Hono + Cloudflare Pages/D1 + Tailwind(CDN) + Chart.js
- **상태**: 샌드박스 개발 서버 동작 중 / 프로덕션 미배포
- **Last Updated**: 2026-10-06

---
## About this repository (original content)
```mermaid
graph LR
    A[Natural Language Input] --> B[Genspark Super Agent]
    B --> C[LLM Processing]
    C --> D[Code Generation/Analysis]
    D --> E[GitHub Integration]
    E --> F[Repository Updates]
```
