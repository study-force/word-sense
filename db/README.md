# 훈감각 익히기 — DB 구축 가이드

이 폴더의 SQL 파일들로 Supabase에 콘텐츠 DB를 구축합니다.

---

## 🗺️ 프로젝트 매핑

| 레이어 | 이름 | 위치 |
|---|---|---|
| 프론트엔드 코드 / GitHub repo | **`word-sense`** | github.com/study-force/word-sense |
| Supabase 데이터베이스 | **`word-master`** | supabase.com (조직: thegreatedu) |
| 서비스 명칭 | **훈감각 익히기** | (사용자 노출명) |

> 같은 서비스의 다른 레이어이며, 이름이 달라도 관리상 무리 없습니다.
> Supabase 접근은 Project URL + API Key로 이루어지므로 프로젝트 이름과는 무관합니다.

---

## 📦 파일 구성

| 파일 | 내용 | 실행 순서 |
|---|---|---|
| `01_content_schema.sql` | 5개 테이블 + 인덱스 + RLS + view | 1️⃣ |
| `02_seed_areas.sql` | 영역(생물/사회/...) 6개 초기 데이터 | 2️⃣ |
| (다음) `03_migration.sql` 또는 Python 스크립트 | Excel → DB 일괄 import | 3️⃣ 박차장님 검수 후 |

---

## 🗂 ER 다이어그램 (텍스트)

```
            ┌────────────┐
            │   areas    │  (6행)
            └─────┬──────┘
                  │ area_id
                  ▼
            ┌────────────┐
            │  sessions  │  (300행)  ← 主字, 어원, 다의 카드
            └─────┬──────┘
                  │ session_id
                  ▼
            ┌────────────────┐         ┌────────────┐
            │ session_words  │────────→│ word_master│  (4,432행, SSOT)
            │ (6,096행)      │  word_  │  ← 정답 풀이 │
            │ ← 빈칸문장,4지선다│  master_id          │
            └────────────────┘         └────────────┘

            ┌────────────┐
            │ wrong_words│  ← 회차별 오답 입력 피드백
            └────────────┘
                  │ session_id
                  └─→ sessions
```

**핵심 포인트**:
- `word_master`는 어휘별 정답 풀이를 단 한 곳에만 저장 (SSOT)
- `session_words`는 회차마다 달라지는 부분(빈칸문장, 4지선다)만 저장
- 같은 어휘가 여러 회차에 등장해도 정답 풀이 수정은 `word_master` 한 번만

---

## 🚀 단계별 실행 가이드

### 1단계 — Supabase 프로젝트 생성

1. [supabase.com](https://supabase.com) 가입 / 로그인
2. **New Project** 클릭
3. 입력:
   - **Name**: `hungamgak` (또는 원하는 이름)
   - **Database Password**: 강한 비밀번호 (저장해두기)
   - **Region**: `Northeast Asia (Seoul)` 추천
4. 생성 대기 (약 1~2분)

### 2단계 — 스키마 적용

1. Supabase 대시보드 → 좌측 **SQL Editor** 클릭
2. **+ New query** → 이름: "Content schema"
3. `01_content_schema.sql` 내용 전체 복사 → 붙여넣기 → **RUN** (▶)
4. 좌측 **Table Editor**에서 5개 테이블 생성됐는지 확인:
   - areas, sessions, word_master, session_words, wrong_words

### 3단계 — 시드 데이터 입력

1. SQL Editor → **+ New query** → 이름: "Seed areas"
2. `02_seed_areas.sql` 내용 붙여넣기 → **RUN**
3. Table Editor → `areas` 테이블 → 6행 확인

### 4단계 — 콘텐츠 import (박차장님 검수 후)

박차장님 검수가 완료된 Excel(`훈감각_사전콘텐츠.xlsx`)이 준비되면:
- **자동화 스크립트** (Python supabase-py 또는 Node.js) 작성 → 실행
- 또는 CSV 변환 후 Supabase Studio의 **Import data** 기능 활용

→ 이 스크립트는 별도로 작성합니다 (Excel 최종 형식 확정 후).

---

## 🔌 앱 연동 (data.js → Supabase)

### Supabase 클라이언트 설치 (앱 측)

`<head>`에 CDN 추가:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

### data.js 교체 패턴

**현재 (정적)**:
```js
var SESSION = {
  id: 1,
  area: '환경과 생물',
  mainChar: '生',
  // ...
  words: [...]
};
```

**변경 후 (DB fetch)**:
```js
const supabaseUrl = 'https://xxxxx.supabase.co';        // Project Settings → API
const supabaseKey = 'eyJhbGc...';                        // anon key (public 안전)
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

async function loadSession(areaSlug, roundNo) {
  // 1. session 정보
  const { data: session } = await supabase
    .from('sessions')
    .select(`
      *,
      area:areas(name_ko, emoji)
    `)
    .eq('area_id', /* areaId from areaSlug */)
    .eq('round_no', roundNo)
    .single();

  // 2. 어휘 목록 (view 활용)
  const { data: words } = await supabase
    .from('v_session_word_full')
    .select('*')
    .eq('session_id', session.id)
    .order('order_in_session');

  // 3. 오답 피드백
  const { data: wrongWords } = await supabase
    .from('wrong_words')
    .select('word, feedback')
    .eq('session_id', session.id);

  return { session, words, wrongWords };
}
```

→ 기존 `var SESSION = ...` 자리에 `SESSION = await loadSession(...)` 만 넣으면 끝.

---

## 🔐 보안 정리

### 콘텐츠 (이 단계)
- **모든 학생이 SELECT 가능** (RLS `public_read` 정책)
- INSERT/UPDATE/DELETE는 막힘 (정책 없음 + RLS 활성)
- 운영자는 Supabase Studio 또는 service_role 키로 작업

### 학습 기록 (Phase 2)
- 구서버 백엔드만 INSERT 가능 (service_role 키 사용)
- 앱은 학습 기록 테이블에 직접 접근 안 함

### 키 관리
| 키 | 노출 가능 | 용도 |
|---|---|---|
| **anon key** | ✅ 앱 코드에 노출 OK | 콘텐츠 SELECT 전용 |
| **service_role key** | ❌ 절대 노출 X | 백엔드 전용 (모든 권한) |

---

## 📊 비용 (예상)

Supabase 무료 티어:
- DB: 500MB (우리 콘텐츠 + 학습기록 충분 — 학생 수만 명 규모까지)
- API 요청: 월 50,000건 무료
- Storage: 1GB
- Bandwidth: 5GB/월

→ **초기 운영 ~ 학생 수천 명까지는 무료로 가능**.  
→ 학생 1만명 이상 / 동시접속 많으면 Pro($25/월) 검토.

---

## 🛣 다음 단계

### Phase 1 (지금)
- [x] 스키마 SQL 작성
- [ ] Supabase 프로젝트 생성
- [ ] `01_content_schema.sql` 실행
- [ ] `02_seed_areas.sql` 실행
- [ ] 박차장님 검수 완료 대기
- [ ] Excel → DB 마이그레이션 스크립트 작성 + 실행
- [ ] 앱 코드(`data.js`) Supabase fetch로 교체

### Phase 2 (다음)
- [ ] 학습 기록 테이블 (attempts, word_results, area_progress)
- [ ] 구서버 ↔ Supabase 연동 (service_role 백엔드 프록시)
- [ ] 학생 분석 대시보드

### Phase 3 (그 다음)
- [ ] dictionary_lookup (표준국어대사전 + 우리말샘)
- [ ] 사용자 입력 분류 시스템

---

## ❓ 트러블슈팅

### "permission denied for table xxx"
→ RLS 정책 미적용. `01_content_schema.sql` 끝부분 RLS/POLICY 부분 다시 실행.

### "duplicate key value violates unique constraint"
→ `02_seed_areas.sql`을 두 번 실행한 경우. 정상 — 무시 가능.  
→ 다시 깨끗이 시작하려면: `TRUNCATE areas RESTART IDENTITY CASCADE;` 후 재실행.

### Supabase 대시보드 접속 안 됨
→ 프로젝트가 일시 정지됐을 수 있음 (무료 티어는 7일 비활성 시 정지). 대시보드에서 **Restore project** 클릭.

---

문서 버전: v1.0 · 2026-05-03
