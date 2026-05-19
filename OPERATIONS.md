# 훈감각 익히기 — 운영 매뉴얼

> 이 문서는 신규 개발자/운영자가 시스템을 빠르게 파악하고 작업할 수 있도록 설계됐습니다.
> 작업 히스토리는 `HANDOFF.md`, 외부 연동 명세는 `INTEGRATION_GUIDE.md` 참고.
> 작성: 2026-05-18

---

## 1. 시스템 개요

**훈감각 익히기**(word-sense) — 한자의 훈(訓)으로 어휘 추론 감각을 키우는 학습 웹앱.

### 학습 흐름
1. **도입 (charintro)** — 오늘의 한자 어원·의미 카드
2. **인출 (game)** — 학생이 主字가 들어간 가족 어휘 직접 입력
3. **확장 (learn)** — 못 떠올린 어휘를 의미 추론(4지선다)으로 깨움
4. **강화 (fillq)** — 가족 어휘들의 의미 빈칸 채우기
5. **결과 (result)** — 점수·랭킹·등급 배지

### 콘텐츠 규모 (현재)
- 6 영역 × 50회차 = **300회차** (계획)
- 현재 운영: 생물 1·2회차만 활성, 나머지 회차는 잠금
- 회차당 가족 어휘 평균 14개 (max 44개)
- 전체 가족 어휘 **약 4,400개** (`word_master`)

### 기술 스택
| 영역 | 사용 기술 |
|---|---|
| 프론트엔드 | **단일 HTML** (`word-sense.html`, ~300KB 바닐라 JS/CSS) |
| 데이터 | Supabase (PostgreSQL + Edge Functions + Auth) |
| 호스팅 | Vercel (정적 사이트) |
| 외부 연동 | Supabase Edge Functions (Deno) + 구서버 service-back API |
| 인증 | JWT (Bearer, X-External-Secret) |

---

## 2. 아키텍처

### 환경 분리 (운영 / 개발)

```
─────────────────────────────────────────────────────────────────────
 운영(PROD)                       개발(DEV)
─────────────────────────────────────────────────────────────────────
 도메인  word.sfcenter.co.kr      word.sfos.kr + *.vercel.app
 DB      word-master              word-master-dev
         (thegreatedu Pro)        (별도 free org)
 Edge    fokuojmzhttxfkmiutmf     xzxgsqpvtckxgvipchsy
 .functions.supabase.co/...       .functions.supabase.co/...
─────────────────────────────────────────────────────────────────────
```

**도메인 분기는 클라이언트가 자동 처리** — `data-supabase.js`가 hostname 기반으로 운영/개발 DB 자동 선택.

```js
// data-supabase.js
const IS_DEV_ENV = hostname === 'word.sfos.kr'
                || hostname === 'localhost'
                || hostname.endsWith('.vercel.app');
```

### 학원 진입 흐름 (외부 연동)

```
[학원 마이룸 (*.sfcenter.co.kr)]
   ↓ 학생 "한자 훈련" 클릭
   ↓ POST application/json
[Supabase Edge Function: wordsense-start]
   ↓ session_init INSERT (UUID, TTL 10분)
   ↓ { redirectUrl: "https://word.sfcenter.co.kr/?st={uuid}" }
[구서버가 학생 브라우저를 redirectUrl로 이동]
[학생 브라우저 — word.sfcenter.co.kr]
   ↓ ?st 파라미터 → fetch wordsense-session → 학생 정보 로드
   ↓ 학습 진행 (인출 → 확장 → 강화 → 결과)
   ↓ 결과 진입 시 wordsense-complete 자동 호출
[Supabase Edge Function: wordsense-complete]
   ↓ service-back JWT 캐시 또는 발급
   ↓ POST /api/public/hanja/study/complete
[구서버 sf_study_hanja 업데이트]
```

상세는 `INTEGRATION_GUIDE.md` 참고.

---

## 3. 폴더 구조

```
word-sense/
├── word-sense.html         ← 메인 앱 (단일 HTML)
├── data-supabase.js        ← Supabase 클라이언트 + 회차 데이터 fetch (환경 분기)
├── vercel.json             ← Vercel 배포 설정 (redirects, headers)
├── .vercelignore           ← Vercel 배포 제외 목록
│
├── db/                     ← DB 스키마 + 마이그레이션 (Git 관리)
│   ├── 01_content_schema.sql       ← 콘텐츠 테이블 (areas, sessions, word_master 등)
│   ├── 02_seed_areas.sql           ← 6 영역 시드
│   ├── 03_records_schema.sql       ← 학습 기록 테이블 (attempts, word_results 등)
│   ├── 04_seed_test_records.sql    ← 테스트 데이터
│   ├── 05_dict_lookup_schema.sql   ← 사전 lookup 테이블
│   └── migrations/                 ← 날짜별 변경 SQL
│       └── 2026-05-NN_*.sql        ← 적용 순서대로
│
├── supabase/               ← Supabase CLI 작업 (Git 관리, Edge Functions 포함)
│   ├── config.toml         ← Supabase 프로젝트 설정
│   ├── .gitignore          ← .temp/, .branches/ 제외
│   └── functions/
│       ├── wordsense-start/index.ts     ← 구서버 진입 receiver
│       ├── wordsense-session/index.ts   ← 학생 정보 fetch
│       └── wordsense-complete/index.ts  ← 학습 완료 service-back 알림
│
├── 콘텐츠/                 ← 내부 콘텐츠 자료 (.gitignore)
├── 기획/                   ← 내부 기획 자료 (.gitignore)
├── .claude/                ← Claude Code 작업 임시 (.gitignore)
├── .dump/                  ← DB 덤프 작업 폴더 (.gitignore)
│
├── HANDOFF.md              ← 작업 히스토리 (이전 세션 컨텍스트)
├── INTEGRATION_GUIDE.md    ← 외부 연동 명세
└── OPERATIONS.md           ← 이 문서
```

---

## 4. 데이터베이스 (Supabase)

### 운영/개발 프로젝트 정보

| 환경 | 조직 | 프로젝트명 | Project Ref |
|---|---|---|---|
| 운영 | thegreatedu (Pro) | word-master | `fokuojmzhttxfkmiutmf` |
| 개발 | enature0405-5319 (free) | word-master-dev | `xzxgsqpvtckxgvipchsy` |

### 핵심 테이블

| 테이블 | 용도 |
|---|---|
| `areas` | 6 영역 (생물·물리·화학·지구·기술·문화) |
| `sessions` | 회차 (영역 × 50, 한자 주자·어원·다의) |
| `word_master` | 가족 어휘 전체 (word + hanja 복합키, 동음이의어 지원) |
| `session_words` | 회차별 가족 어휘 연결 (예문·choices) |
| `wrong_words` | 회차별 오답 피드백 |
| `dict_lookup` | 사전 lookup (표준국어대사전) |
| `attempts` (Phase 2) | 학생별 시도 기록 |
| `word_results` (Phase 2) | 학생별 어휘 결과 |

### 외부 연동용 테이블

| 테이블 | 용도 |
|---|---|
| `students` | 외부 진입 학생 정보 (`user_no` PK) |
| `academies` | 학원 정보 (`academy_no` PK) |
| `session_init` | UUID 토큰 임시 저장 (10분 TTL) |
| `service_back_token` | service-back JWT 캐시 (singleton) |

### 마이그레이션 적용 방법

새 SQL 파일을 `db/migrations/`에 만들고 **운영/개발 양쪽 DB**에 적용:

**방법 A — Supabase Dashboard (권장, GUI):**
1. https://supabase.com → 프로젝트 선택
2. SQL Editor → New query
3. 마이그레이션 파일 내용 복붙 → RUN
4. 운영 → 개발 순서로 양쪽 적용

**방법 B — CLI (개발자):**
```bash
cd word-sense
supabase link --project-ref <project-ref>
psql "postgresql://postgres.<ref>@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres" \
  -f db/migrations/2026-MM-DD_xxx.sql
```

---

## 5. Edge Functions (외부 연동)

### 함수 목록

| 함수 | 용도 | 호출 주체 |
|---|---|---|
| `wordsense-start` | 구서버에서 학생 진입 시작, sessionId 발급 | 구서버 |
| `wordsense-session` | 학생 정보 + 회차 데이터 반환 | 클라이언트(브라우저) |
| `wordsense-complete` | 학습 완료 → service-back 알림 | 클라이언트(브라우저) |

### wordsense-start 요청 형식 (doc1 명세)

⚠️ **`user_section`(학제) + `user_school_grade`(학년)은 별개 필드.** 합쳐서 (`"초3"`) 보내면 안 됨. 자세한 명세는 `INTEGRATION_GUIDE.md` 참고.

```json
{
  "name":              "홍길동",            // string, 필수
  "user_no":           86453,                // number, 필수
  "user_section":      "중등",               // string (초등/중등/고등/초등(고)/N수생/일반)
  "user_school_grade": 2,                    // number (1~6 등)
  "academy_name":      "공부의철인(분당본원)",
  "academy_no":        1904,
  "is_payment":        "Y",                  // "Y" / "N"
  "payment_fn":        "62cbf3457ddb6cf2a460692215136dac",  // string, 필수
  "training_round":    17                    // number, 필수
}
```

학제·학년은 `students` 테이블에 `section` (TEXT) / `school_grade` (INT) 별개 컬럼으로 저장됨.

### Supabase Secrets (Edge Function 환경 변수)

Dashboard → Project Settings → Edge Functions → Secrets에서 관리:

| 키 | 값 (운영/개발 다름) |
|---|---|
| `EXTERNAL_JWT_SECRET` | 운영팀에서 받은 키 |
| `SERVICE_BACK_BASE_URL` | 운영: `:8143/service-back` / 개발: `:8193/service-back` |
| `STUDENT_REDIRECT_BASE` | 운영: `word.sfcenter.co.kr` / 개발: `word.sfos.kr` |
| `ALLOWED_ORIGINS` (선택) | 추가 origin 화이트리스트 |

### 배포 방법

```bash
cd word-sense
supabase login
supabase link --project-ref <project-ref>   # 운영 또는 개발
supabase functions deploy wordsense-start --no-verify-jwt
supabase functions deploy wordsense-session --no-verify-jwt
supabase functions deploy wordsense-complete --no-verify-jwt
```

`--no-verify-jwt` 필수 — 외부 호출용이라 Supabase JWT 검증 우회.

---

## 6. 도메인 + 배포 (Vercel)

### 등록 도메인

| 도메인 | 환경 | DNS |
|---|---|---|
| `word.sfcenter.co.kr` | 운영 | CNAME word → `4a41084b6daf6c5a.vercel-dns-017.com.` |
| `word.sfos.kr` | 개발 | CNAME word → `4a41084b6daf6c5a.vercel-dns-017.com.` |
| `word-sense.vercel.app` | 자동 (개발) | Vercel 기본 |

### 배포 흐름

main 브랜치 push → **Vercel 자동 배포** (~1-2분).

확인: vercel.com → word-sense → Deployments 탭

### 도메인 신규 추가가 필요할 때
1. Vercel → Settings → Domains → 도메인 입력 → Save
2. Vercel이 안내하는 DNS 레코드 확인 (CNAME)
3. IT팀에 DNS 등록 요청 (`INTEGRATION_GUIDE.md` 의 IT팀 메시지 템플릿 참고)

---

## 7. 개발 워크플로우

### 로컬 미리보기
```bash
cd word-sense
node .claude/server.js     # 포트 5173/5188 정적 서버
```

또는 VS Code Live Server 등 정적 파일 서버 무엇이든 OK.

### Git 브랜치 정책
- **main** — 운영 (push 시 자동 배포)
- **dev** (있는 경우) — 개발/실험
- 메모리 규칙: dev는 확인 없이 커밋/푸시 OK, main은 반드시 확인

### 일반 작업 절차
1. 변경 → 미리보기로 확인
2. 커밋 (의미 단위로 분리)
3. push → Vercel 자동 배포
4. word.sfos.kr (개발)에서 검증
5. 문제 없으면 운영 도메인에서 최종 확인

---

## 8. 콘텐츠 관리

### 새 회차 추가
1. `sessions` 테이블에 행 추가 (한자 주자·어원·다의)
2. `word_master`에 가족 어휘 INSERT (없는 경우)
3. `session_words`로 회차에 어휘 연결 (예문·choices 포함)
4. 운영/개발 DB 양쪽 적용

### 동음이의어 추가 (예시)
참고: `db/migrations/2026-05-17_add_생식_生食.sql`

핵심 패턴:
```sql
INSERT INTO word_master (word, hanja, char1, hun1, char2, hun2, meaning, grade)
VALUES ('생식', '生食', '生', '날 생', '食', '먹을 식', '...', 3)
ON CONFLICT (word, hanja) DO UPDATE ...;

INSERT INTO session_words (...)
SELECT ... FROM sessions s WHERE s.round_no = 1 ...;
```

### 어휘 의미 / 예문 수정
SQL Editor에서 직접 UPDATE:
```sql
UPDATE word_master
SET meaning = '새로운 의미', updated_at = NOW()
WHERE word = '생명' AND hanja = '生命';
```

---

## 9. 자주 하는 작업

### Edge Function 코드 수정 + 재배포
```bash
# supabase/functions/<name>/index.ts 편집
supabase functions deploy <name> --no-verify-jwt
```

### Edge Function 로그 확인
Supabase Dashboard → Edge Functions → 함수 클릭 → Logs 탭

### 새 환경변수(Secret) 추가
Dashboard → Project Settings → Edge Functions → Secrets → Add new secret  
(운영/개발 양쪽 다 추가)

### DB 데이터 백업
운영 DB 덤프:
```bash
PGPASSWORD='...' pg_dump \
  "postgresql://postgres.fokuojmzhttxfkmiutmf@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres" \
  --schema=public --no-owner --no-acl \
  > prod_dump_$(date +%Y%m%d).sql
```

### 운영 → 개발 DB 동기화 (콘텐츠만)
```bash
# 1. 덤프 (위 명령)
# 2. 개발 DB에 복원
PGPASSWORD='개발비번' psql \
  "postgresql://postgres.xzxgsqpvtckxgvipchsy@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres" \
  -f prod_dump_YYYYMMDD.sql
```

---

## 10. 트러블슈팅

### 학생 정보 안 뜸 (외부 진입)
- 콘솔 `[student] session 조회 실패: 404` → session_init 만료(10분 TTL) 또는 sessionId 잘못
- 콘솔 `session fetch 오류` → CORS 또는 네트워크. Edge Function `ALLOWED_ORIGINS` 학원 origin 추가

### 학습 완료 후 sf_study_hanja 업데이트 안 됨
- 콘솔 `service-back 알림 실패`
  - 400 결제 정보 없음 → payment_fn 잘못 전달
  - 401 인증 실패 → `EXTERNAL_JWT_SECRET` 잘못
- `service_back_token` 테이블 토큰 캐시 확인
- 토큰 회수 의심 시 `DELETE FROM service_back_token;` → 다음 호출 시 재발급

### Vercel 배포 안 됨
- vercel.com → Deployments에서 Build 로그 확인
- vercel.json 문법 오류 / .vercelignore 잘못된 패턴 등

### DB 비밀번호 분실
Dashboard → Project Settings → Database → "Reset database password"

### `--no-verify-jwt` 안 붙이고 배포한 경우
Edge Function이 401 Unauthorized 반환. 재배포 with flag:
```bash
supabase functions deploy <name> --no-verify-jwt
```

---

## 11. 보안 / 시크릿 관리

### 코드에 절대 들어가면 안 되는 것
- DB password
- service_role key (백엔드 전용)
- EXTERNAL_JWT_SECRET

### 코드에 들어가도 되는 것 (공개 키)
- SUPABASE_URL
- SUPABASE_ANON_KEY (RLS 정책으로 보호되는 공개 키)

### `.gitignore` 필수 항목
- `.env.local`, `.secrets.local` (시크릿)
- `prod_dump.sql`, `dev_dump.sql` (DB 덤프)
- `.claude/`, `.dump/`, `콘텐츠/`, `기획/` (작업 임시 / 내부 자료)

---

## 12. 연락처 / 리소스

### Supabase
- 대시보드: https://supabase.com/dashboard/projects
- 문서: https://supabase.com/docs

### Vercel
- 대시보드: https://vercel.com/enature0405-5319s-projects/word-sense
- 문서: https://vercel.com/docs

### GitHub
- 레포: https://github.com/study-force/word-sense
- 브랜치: main (운영 배포 트리거)

### 외부 시스템
- 학원 마이룸 (구서버): `*.sfcenter.co.kr`
- service-back API: doc1·doc2 명세 (`기획/` 폴더 내부)

---

## 부록 — 작업 흐름 빠른 참조

### 콘텐츠만 수정 (의미·예문)
1. SQL UPDATE → 운영/개발 DB 적용 → 끝 (코드 변경 X)

### 새 회차 / 동음이의어 추가
1. `db/migrations/YYYY-MM-DD_xxx.sql` 작성
2. SQL Editor에서 운영/개발 양쪽 RUN
3. 마이그레이션 파일 Git 커밋

### UI 변경
1. `word-sense.html` 편집
2. 로컬 미리보기 확인
3. main push → Vercel 자동 배포
4. 개발 도메인(word.sfos.kr)에서 검증
5. 운영 도메인(word.sfcenter.co.kr)에서 최종 확인

### Edge Function 변경
1. `supabase/functions/<name>/index.ts` 편집
2. `supabase functions deploy <name> --no-verify-jwt` (운영/개발 각각)
3. Edge Functions Logs로 동작 확인

### 사고 대응 (긴급 롤백)
1. Vercel → Deployments → 이전 deployment "..." → "Promote to Production"
2. 또는 git revert + push
