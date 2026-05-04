-- ════════════════════════════════════════════════════════════════
-- 훈감각 익히기 — 학습 기록 DB 스키마 (Phase 2)
-- DB: Supabase Postgres
-- Version: 1.1
-- Date: 2026-05-04
--
-- 전제:
--   • 회원 시스템은 구서버(PHP)가 소유 — Supabase Auth는 사용 안 함
--   • 구서버 → 학생 브라우저로 JWT 발급 (1시간, 자동 갱신)
--   • JWT payload: { member_no, login_id, name, grade, center, iat, exp }
--       - member_no  : 구서버 회원 번호 (BIGINT, 안정 PK — DB 매칭·RLS에 사용)
--       - login_id   : 구서버 로그인 ID (TEXT, 학생이 입력하는 값 — 표시용)
--   • 학생 브라우저 → Supabase 직접 호출 시 JWT 첨부 (Authorization: Bearer)
--   • Supabase는 RLS에서 JWT의 member_no 검증
--
-- 회원 번호 타입:
--   • 일반적인 레거시 회원 시스템은 BIGINT(AUTO_INCREMENT) PK 사용 → BIGINT 채택
--   • 구서버 실제 타입 다르면 ALTER TABLE 또는 DROP+재생성 필요
--   • TEXT가 아닌 BIGINT를 PK로 잡는 이유: 인덱스 성능, JOIN 성능, 저장 공간
--
-- 적용 순서:
--   1) 01_content_schema.sql  (Phase 1 — 이미 적용됨)
--   2) 02_seed_areas.sql       (Phase 1 — 이미 적용됨)
--   3) 03_records_schema.sql   ← 이 파일
-- ════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════
-- 1. user_profile_cache (학생 정보 사본 — 구서버에서 동기화)
--   • 랭킹 화면·결과 화면에서 매번 구서버 호출 안 하려고 캐시
--   • last_synced_at 기준 24시간 지나면 갱신 (백엔드 lazy refresh)
--   • PK는 member_no (안정 식별자), login_id는 표시용 별도 컬럼
-- ════════════════════════════════════════
CREATE TABLE user_profile_cache (
  member_no         BIGINT PRIMARY KEY,            -- 구서버 회원 번호 (JWT의 member_no)
  login_id          TEXT NOT NULL,                 -- 구서버 로그인 ID (JWT의 login_id, 표시용)
  name              TEXT NOT NULL,                 -- 학생 이름
  grade             SMALLINT,                      -- 학년 (1~12 등 자유)
  center            TEXT,                          -- 센터명 (예: '강남센터')
  last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE user_profile_cache IS '구서버 학생 정보 캐시 — 랭킹/결과 화면 표시용. 24h마다 갱신';
COMMENT ON COLUMN user_profile_cache.member_no IS '구서버 회원 번호 (안정 PK, FK·RLS 매칭에 사용)';
COMMENT ON COLUMN user_profile_cache.login_id  IS '구서버 로그인 ID (학생이 입력하는 값, 표시용)';
CREATE INDEX idx_profile_cache_center_grade ON user_profile_cache (center, grade);
CREATE INDEX idx_profile_cache_login_id     ON user_profile_cache (login_id);


-- ════════════════════════════════════════
-- 2. attempts (회차 시도 — 한 학생이 한 회차 한 번 시도 = 1행)
--   • 같은 회차 재시도 가능 → 같은 (user, session)에 여러 행 가능
--   • is_passed=true 한 번이라도 있으면 area_progress의 cleared_count에 반영
-- ════════════════════════════════════════
CREATE TABLE attempts (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_no         BIGINT NOT NULL,                               -- 구서버 회원 번호
  session_id        BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  area_id           BIGINT NOT NULL REFERENCES areas(id),          -- 비정규화 (랭킹·통계 빠르게)
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ,                                   -- NULL이면 진행 중·중단
  duration_sec      INTEGER,                                       -- finished_at - started_at (캐시)
  total_words       SMALLINT NOT NULL,                             -- 출제된 어휘 수
  correct_count     SMALLINT NOT NULL DEFAULT 0,                   -- 맞힌 어휘 수
  is_passed         BOOLEAN NOT NULL DEFAULT false,                -- 통과 여부 (정답률 임계치 충족)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE attempts IS '회차 시도 기록 — 한 회차 1번 = 1행, 재시도 시 새 행';
CREATE INDEX idx_attempts_member_session ON attempts (member_no, session_id, finished_at DESC);
CREATE INDEX idx_attempts_member_area    ON attempts (member_no, area_id);
CREATE INDEX idx_attempts_session        ON attempts (session_id, finished_at DESC);


-- ════════════════════════════════════════
-- 3. word_results (시도 안의 어휘별 정답/오답 — attempts 자식)
--   • 1 attempt × N words = N rows
--   • 학생별 약점 어휘 분석에 활용
-- ════════════════════════════════════════
CREATE TABLE word_results (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id        BIGINT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  member_no         BIGINT NOT NULL,                               -- 비정규화 (자주 조회)
  session_word_id   BIGINT NOT NULL REFERENCES session_words(id) ON DELETE CASCADE,
  word_master_id    BIGINT NOT NULL REFERENCES word_master(id),    -- 비정규화 (어휘 단위 통계 빠르게)
  is_correct        BOOLEAN NOT NULL,
  selected_choice   TEXT,                                          -- 학생이 고른 보기 텍스트 (오답 분석용)
  answered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE word_results IS '어휘별 정답/오답 기록 — 약점 어휘 분석에 사용';
CREATE INDEX idx_word_results_attempt      ON word_results (attempt_id);
CREATE INDEX idx_word_results_member_word  ON word_results (member_no, word_master_id, answered_at DESC);
CREATE INDEX idx_word_results_word         ON word_results (word_master_id) WHERE is_correct = false;  -- 오답률 통계용


-- ════════════════════════════════════════
-- 4. area_progress (학생×영역 진행도 — 캐시값, 자주 조회)
--   • 영역 카드 화면에서 "X/50회차 통과" 표시
--   • 트리거로 attempts 변경 시 자동 갱신
-- ════════════════════════════════════════
CREATE TABLE area_progress (
  member_no         BIGINT NOT NULL,
  area_id           BIGINT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  cleared_count     SMALLINT NOT NULL DEFAULT 0,                   -- 통과한 회차 수 (DISTINCT session)
  total_attempts    INTEGER NOT NULL DEFAULT 0,                    -- 누적 시도 횟수
  last_session_id   BIGINT REFERENCES sessions(id),                -- 마지막으로 시도한 회차
  last_attempt_at   TIMESTAMPTZ,
  PRIMARY KEY (member_no, area_id)
);
COMMENT ON TABLE area_progress IS '학생×영역 진행도 — 영역 카드 표시용 캐시. 트리거 자동 갱신';
CREATE INDEX idx_area_progress_area_count ON area_progress (area_id, cleared_count DESC);  -- 랭킹용


-- ════════════════════════════════════════
-- 5. 트리거 — attempts 변경 시 area_progress 자동 갱신
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION refresh_area_progress()
RETURNS TRIGGER AS $$
DECLARE
  v_member BIGINT;
  v_area   BIGINT;
BEGIN
  -- INSERT/UPDATE는 NEW, DELETE는 OLD 사용
  IF (TG_OP = 'DELETE') THEN
    v_member := OLD.member_no;
    v_area   := OLD.area_id;
  ELSE
    v_member := NEW.member_no;
    v_area   := NEW.area_id;
  END IF;

  INSERT INTO area_progress (member_no, area_id, cleared_count, total_attempts, last_session_id, last_attempt_at)
  SELECT
    v_member,
    v_area,
    COUNT(DISTINCT a.session_id) FILTER (WHERE a.is_passed)::SMALLINT,
    COUNT(*)::INTEGER,
    (SELECT session_id FROM attempts
       WHERE member_no = v_member AND area_id = v_area
       ORDER BY COALESCE(finished_at, started_at) DESC LIMIT 1),
    MAX(COALESCE(a.finished_at, a.started_at))
  FROM attempts a
  WHERE a.member_no = v_member AND a.area_id = v_area
  ON CONFLICT (member_no, area_id) DO UPDATE SET
    cleared_count    = EXCLUDED.cleared_count,
    total_attempts   = EXCLUDED.total_attempts,
    last_session_id  = EXCLUDED.last_session_id,
    last_attempt_at  = EXCLUDED.last_attempt_at;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attempts_refresh_progress
  AFTER INSERT OR UPDATE OF is_passed, finished_at OR DELETE
  ON attempts
  FOR EACH ROW EXECUTE FUNCTION refresh_area_progress();


-- ════════════════════════════════════════
-- 6. RLS (Row Level Security) — JWT 기반
--   • Supabase는 JWT의 클레임을 request.jwt.claims로 노출
--   • 우리는 member_no 클레임을 BIGINT로 캐스팅해서 매칭
--   • SELECT/INSERT/UPDATE: 자기 행만
--   • 랭킹 조회는 view를 통해 (집계만 노출)
-- ════════════════════════════════════════
ALTER TABLE user_profile_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE word_results       ENABLE ROW LEVEL SECURITY;
ALTER TABLE area_progress      ENABLE ROW LEVEL SECURITY;

-- 자기 행만 SELECT
CREATE POLICY "own_select" ON user_profile_cache
  FOR SELECT USING (member_no = (current_setting('request.jwt.claims', true)::json->>'member_no')::BIGINT);

CREATE POLICY "own_select" ON attempts
  FOR SELECT USING (member_no = (current_setting('request.jwt.claims', true)::json->>'member_no')::BIGINT);

CREATE POLICY "own_select" ON word_results
  FOR SELECT USING (member_no = (current_setting('request.jwt.claims', true)::json->>'member_no')::BIGINT);

CREATE POLICY "own_select" ON area_progress
  FOR SELECT USING (member_no = (current_setting('request.jwt.claims', true)::json->>'member_no')::BIGINT);

-- 자기 행만 INSERT
CREATE POLICY "own_insert" ON attempts
  FOR INSERT WITH CHECK (member_no = (current_setting('request.jwt.claims', true)::json->>'member_no')::BIGINT);

CREATE POLICY "own_insert" ON word_results
  FOR INSERT WITH CHECK (member_no = (current_setting('request.jwt.claims', true)::json->>'member_no')::BIGINT);

-- 자기 attempts UPDATE (시도 마무리할 때 finished_at, correct_count 등)
CREATE POLICY "own_update" ON attempts
  FOR UPDATE USING (member_no = (current_setting('request.jwt.claims', true)::json->>'member_no')::BIGINT);

-- user_profile_cache·area_progress의 INSERT/UPDATE는 service_role 또는 트리거만 (정책 안 만듦)


-- ════════════════════════════════════════
-- 7. 랭킹 view — 집계만 노출, 개인 식별 정보 차단
--   • 영역별 통과 회차 수 기준 내림차순
--   • 이름·센터·학년은 join해서 표시 (게임 특성상 공개 OK)
--   • login_id는 view에서 제외 (보안)
-- ════════════════════════════════════════
CREATE OR REPLACE VIEW v_area_ranking AS
SELECT
  ap.area_id,
  ap.member_no,
  upc.name,
  upc.grade,
  upc.center,
  ap.cleared_count,
  RANK() OVER (PARTITION BY ap.area_id ORDER BY ap.cleared_count DESC) AS rank
FROM area_progress ap
LEFT JOIN user_profile_cache upc ON upc.member_no = ap.member_no
WHERE ap.cleared_count > 0;

COMMENT ON VIEW v_area_ranking IS '영역별 랭킹 — 통과 회차 수 기준. 클라이언트는 area_id 필터 + LIMIT 100';

-- 랭킹 view는 누구나 읽기 가능
GRANT SELECT ON v_area_ranking TO anon, authenticated;


-- ════════════════════════════════════════
-- 끝.
-- 다음 단계:
--   • 구서버(PHP)에서 JWT 발급 엔드포인트 작성: POST /api/auth/issue-jwt
--     payload: { member_no, login_id, name, grade, center, iat, exp }
--   • Supabase 프로젝트 설정 → Auth → JWT Secret을 구서버 시크릿과 동일하게 설정
--   • word-sense.html에서 JWT 받아 supabase.createClient 호출 시 global.headers.Authorization 설정
--   • 프론트에서 attempt 시작/종료 시점에 attempts·word_results INSERT
-- ════════════════════════════════════════
