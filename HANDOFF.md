# 훈감각 익히기 — 핸드오프 문서

> 다음 Claude 세션이 빠르게 컨텍스트를 잡을 수 있도록 핵심 정보 정리.
> 작성: 2026-05-08

---

## 1. 프로젝트 개요

**훈감각 익히기** — 한자의 훈(訓)으로 어휘 추론 감각을 키우는 학습 웹앱.

- **로컬 경로**: `C:\Users\이재훈\Desktop\CLAUDE\word-sense`
- **GitHub**: `study-force/word-sense` (main 브랜치)
- **배포**: GitHub Pages — https://study-force.github.io/word-sense/word-sense.html
- **Supabase**: 프로젝트 `thegreatedu/word-master` (Pro 요금제)
- **단일 HTML**: `word-sense.html` (메인 앱, ~300KB)

### 학습 흐름
1. **오늘의 한자** (도입) — 主字 어원·의미 카드
2. **인출** (자유 입력) — 학생이 主字가 들어간 가족 어휘 직접 입력
3. **확장** (추론 학습) — 못 떠올린 가족 어휘를 의미 추론으로 깨움
4. **강화** (빈칸 채우기) — 가족 어휘들의 의미 빈칸 4지선다
5. **결과** — 점수·랭킹·등급 배지

### 콘텐츠 규모
- 6 영역 × 50회차 = **300회차**
- 회차당 가족 어휘 평균 14개
- 전체 가족 어휘 **4,432개** (word_master)
- 빈칸 문장 6,096개

---

## 2. Phase 진행 상태

### ✅ Phase 1 — 콘텐츠 DB (완료)
- `db/01_content_schema.sql` — areas, sessions, word_master, session_words, wrong_words
- `db/02_seed_areas.sql` — 6 영역 시드
- `db/migrate_test.js` — 박차장님 검수본 Excel → SQL 마이그레이션 스크립트
- **현재 적재**: 1·2회차만 (생물 영역). 3~300회차는 박차장님 검수본 받으면 추가.
- 어원·의미 카드 K/L 컬럼 형식: `[1] 나다, 태어나다 → 출생, 탄생`

### ✅ Phase 2 — 학습 기록 DB (스키마 완료, 프론트 미연결)
- `db/03_records_schema.sql` v2.0 — 학습 기록 테이블들
- 테이블: `attempts`, `word_results`, `area_progress`, `user_profile_cache`
- 등급: `tier_level SMALLINT 0~6` (0=미통과, 1~5=10/20/30/40/50개, 6=PERFECT)
- 단계별 점수: `retrieve_count`, `extend_count`, `correct_words`
- 재시도: `attempt_no` 트리거 자동 부여
- 단계 이어가기: `current_stage` (retrieve/extend/reinforce/done)
- View: `v_session_best_tier`, `v_session_ranking`, `v_area_tier_distribution`, `v_area_ranking`
- 통과 평가 = **강화 정답 어휘 수만** (인출/확장은 동기·자존감용)
- **모든 시도 보존** (스케일 미미)
- 📌 **다음 작업**: JWT 발급(구서버 PHP) → frontend 통합 → attempts INSERT 로직

### ✅ Phase 3 — 사용자 입력 분류 시스템 (완료)
- `db/05_dict_lookup_schema.sql` — dict_lookup 테이블 + 분류 RPC 함수
- `db/build_dict_lookup.js` — 표준국어대사전 .xls 15개 → CSV 변환
- **dict_lookup 행수**: 98,891 (한자어 94K + 고유어 3.5K + 외래어 2.1K + 혼종어 525)
- 표제어 정규화: "공생(02)" → "공생", 동음이의어 별개 행 (word, hanja, source UNIQUE)
- RPC `classify_word_input(p_word, p_main_char)` — 4단계 분류
- 받침 자동 을/를·은/는 처리 (PostgreSQL ascii() + 한글 음절 종성 검사)
- word-sense.html submit() 함수에 통합 (RPC 호출 + 캐시)
- 📌 **확장 가능**: 우리말샘 추가 (source=2 폴백)

---

## 3. 동음이의어 처리

박차장님 검수본에 201쌍 동음이의어 발견. word_master 스키마 변경:
- `UNIQUE(word)` → `UNIQUE(word, hanja)` — 동음이의어 별개 행 허용
- 콘텐츠 보강 (B-1 직접 추가 방식):
  - 寄生 1회차 추가 (검수본에 누락)
  - 共生 1회차 추가 (검수본에 누락)
  - 妓生 1회차에서 제거 (영역 부적합)
- 표제어 정규화로 dict_lookup 자동 동음이의어 등재 (공생 4종, 기생 2종 등)

---

## 4. 미해결 이슈 (다음 세션 첫 작업)

### charintro 2단계 morph 모션 — splash 훈음 안 작아짐

**증상**:
- splash 한자 (`ci-splash-char`, 380px) → FLIP transform으로 작은 자리(`ci-char-big` 위치)로 morph ✓
- splash 훈음 (`ci-splash-hun`, 32px) → 같은 로직 적용했는데 morph 안 됨. 큰 크기 그대로.
- 결과: 작은 한자 아래에 큰 훈음이 겹쳐 보임.

**시도한 해결책** (효과 없음):
1. `ciSplashHunIn` 키프레임에서 `transform` 제거 (animation forwards가 transform 잡아서 inline 무시되는 줄 알았으나 안 됨)
2. 커밋 `05b4c59`

**추정 원인**:
- `transition: transform 1s` 설정은 됨
- inline `style.transform` 적용도 됨
- 그런데 시각적으로 적용 안 됨
- → 다른 CSS 규칙이 transform을 덮어쓰고 있을 가능성? 또는 measure 시점 문제?

**디버깅 시작점**:
1. `word-sense.html` `dismissCharIntroSplash()` 함수 (line ~5689+)
2. CSS: `#charintro .ci-splash-hun` (line ~696+)
3. 브라우저 개발자 도구로 inline transform 적용 후 computed style 확인
4. `console.log(hunDst, hunSrc, hunScale, hunDx, hunDy)` 찍어보기

### 추가 요청
- 첫 화면(splash) 큰 한자의 **무게중심을 위로** 약간 이동 (현재 viewport 중앙 → 1/3 지점쯤)

---

## 5. 대표님 선호 · 디자인 패턴

### 디자인 톤
- **분석적·진중한 보고서 스타일** (특히 통계 페이지)
- **타이포그래피 위계** — 중요한 건 크게·굵게, 약한 건 작게·dim
- **이모지 X** — 텍스트만 (한자도 텍스트로 충분히 강조)
- **얇은 선 + 미니멀** — 박스/그림자 과하지 않게
- charintro 페이지(라이트 톤)와 같은 결: 진남색 텍스트 (`#2A3050`, `--ci-accent-deep`), 차분한 무채색
- 게임 페이지(다크 톤)는 #1F2238 + 색상 글로우

### 메시지 톤
- 학생 자존감 충족 우선 — 칭찬형 메시지 풍부
- 명확하게 알려주기 — 모호한 표현 X
- 받침 자동 처리 (을/를, 은/는, 이/가)

### 코드·DB 결정 패턴
- **단순함 우선** — 캐시·denormalization 안 함 (실시간 JOIN으로 항상 정확)
- **데이터 손실 방지** — 모든 시도 보존
- **재실행 안전** — 마이그레이션 idempotent (`IF EXISTS`, `ON CONFLICT`)
- **운영 사이클 인정** — 박차장님 검수본 완성 후 정식화. 그 전엔 핫픽스 OK.

### 작업 흐름
- **dev 브랜치 없음** — main에 직접 commit + push (운영 직전 dev 분기 예정)
- **GitHub Pages 자동 배포** (1~2분)
- **커밋 메시지** — 한국어, "왜 변경했나" 위주
- **에이전트 활용** — 큰 디자인 작업은 general-purpose 에이전트 위임

---

## 6. 자주 쓰는 파일 · 명령어

### 핵심 파일
```
word-sense.html                — 메인 앱 (단일 HTML, 모든 게임 로직)
data-supabase.js               — Supabase 클라이언트 + SESSION 로더
data.js                        — 레거시 정적 데이터 (현재 미사용)
db/01_content_schema.sql       — Phase 1 스키마
db/02_seed_areas.sql           — 6 영역 시드
db/03_records_schema.sql       — Phase 2 학습 기록 스키마
db/04_seed_test_records.sql    — Phase 2 더미 데이터
db/05_dict_lookup_schema.sql   — Phase 3 분류 시스템
db/migrate_test.js             — 박차장님 검수본 → SQL 마이그레이션
db/build_dict_lookup.js        — 표준국어대사전 → CSV 파서
db/migrations/                 — 마이그레이션 SQL 모음 (날짜별)
기획/훈감각_콘텐츠_기획서.docx  — 콘텐츠 정책 (5.4절 분류 시스템 등)
콘텐츠/                        — Excel 원본 (gitignored)
```

### 자주 쓰는 명령어
```bash
# git 상태
git status
git log --oneline -10

# 사전 CSV 재생성
node db/build_dict_lookup.js

# 마이그레이션 적용 (수동 — Supabase Studio SQL Editor 사용)
# https://supabase.com/dashboard → 프로젝트 → SQL Editor
```

### 글로벌 Supabase 클라이언트 (word-sense.html에서 RPC 호출 패턴)
```js
const { data, error } = await window.SUPABASE_CLIENT.rpc('classify_word_input', {
  p_word: val,
  p_main_char: SESSION.mainChar
});
```

---

## 7. 다음 작업 후보 (우선순위)

### A. 즉시 (이 핸드오프 직후)
- charintro morph 버그 해결 (splash 훈음 안 작아짐)
- 큰 한자 화면 무게중심 위로 이동

### B. 단기 (이번 주~다음 주)
- 박차장님 검수본 3~50회차 받으면 1·2회차와 같은 패턴으로 import
- 운영 중 학생 입력 누락 어휘 발견 시 즉시 word_master 추가 (B-1 패턴)
- 우리말샘 사전 추가 (source=2, dict_lookup 보강)
- 표제어 정규화 — `기생01` 같은 끝에 숫자 붙은 케이스 (이미 처리됨, 다른 변형 발견 시 보강)

### C. 중기 (개발자 미팅 후)
- **Phase 2 frontend 통합** — 학습 기록 DB 실데이터 연결
  - 구서버 PHP에서 JWT 발급 endpoint
  - Supabase JWT 시크릿 등록
  - word-sense.html에 학습 흐름 → attempts/word_results INSERT
  - 통계 페이지 mock → 실데이터 fetch
- **랭킹 view** 실데이터 적용
- **회차 이어가기 UI** — finished_at NULL 시 "확장 단계부터 이어할까요?" 안내

### D. 장기
- 박차장님 검수본 전체 300회차 import
- 다른 영역 확장 (사회·역사·과학·문화·경제) 각 50회차
- 모바일앱 (iOS/Android)

---

## 8. 알아두면 좋은 디테일

### Supabase 환경
- DB: PostgreSQL 15+
- JWT Secret: 미설정 (구서버 연동 시 등록 예정)
- RLS: Phase 2 테이블에 적용. JWT claims의 `member_no`로 매칭
- 익명 키 SUPABASE_ANON_KEY는 `data-supabase.js`에 노출 (공개 OK)

### 콘텐츠 정책 (4.x절·5.x절 — 콘텐츠 기획서)
- 가족 어휘 정답 풀이: 두 한자의 훈을 의미에 녹임 + 한자 노출 금지 (4.4.3)
- 4지선다 오답: 같은 회차 가족 어휘 풀에서만 + Goldilocks Zone (4.5)
- 표준국어대사전 직접 인용 금지 (4.7.2 — CC-BY-SA 제약·학습자 인지 부담)
- 학습자 입력 분류: 표준국어대사전 1차 + 우리말샘 2차 폴백 (5.4)

### 회차 구조
- session_words.choices JSONB 형식:
  ```json
  [
    {"text": "정답 풀이", "is_correct": true},
    {"text": "오답1", "is_correct": false},
    {"text": "오답2", "is_correct": false},
    {"text": "오답3", "is_correct": false}
  ]
  ```
- order_in_session으로 회차 내 어휘 순서 관리

### 분류 함수 (classify_word_input) 4단계 분류
1. word_master에 있고 main_char 포함 → `correct` ("꽤 어려운 어휘를 알고 있네요. (다른 회차에서 만나요)")
2. dict_lookup에 있고 한자어 + main_char 포함 → `hanja_with_main` ("정답이에요! 어려운 어휘인데 훌륭해요!")
3. dict_lookup에 있는 어휘:
   - 한자어 → `hanja_word` (frontend에서 "{날 생}(生)의 가족 어휘가 아니에요"로 재구성)
   - 고유어 → `native` ("이건 순우리말이에요!")
   - 외래어 → `foreign` ("이건 외래어랍니다!")
   - 혼종어 → `hybrid` (조합별 메시지 NH/HN/FH/HF/NF/FN)
4. 사전에 없음 → `not_found` ("표준국어대사전에 등록된 어휘가 아니에요.")

---

## 9. 새 세션 시작 시 추천 첫 메시지

```
@HANDOFF.md 읽고 컨텍스트 파악해줘.
지금 진행할 작업: charintro morph 버그 해결.
splash 훈음이 morph 안 되는 문제부터 디버깅해보자.
```

또는 다른 작업 시작 시:
```
@HANDOFF.md 읽어줘.
오늘 할 일: [작업 내용]
```

---

작성: Claude (이전 세션 마지막 정리)
대표님께서 다음 세션에서 이 문서 보여주시면 빠르게 컨텍스트 잡아드릴게요.
