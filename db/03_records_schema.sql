-- ════════════════════════════════════════════════════════════════
-- 훈감각 익히기 — 학습 기록 DB 스키마 (Phase 2)
-- DB: Supabase Postgres
-- Version: 2.0
-- Date: 2026-05-05
--
-- v2.0 변경점:
--   • 단계별 점수 (인출/확장/강화) 분리 저장
--   • 단계 단위 이어가기 (current_stage)
--   • 회차 재시도 횟수 자동 추적 (attempt_no 트리거)
--   • 6단계 등급 체계 (tier_level: 0=미통과, 1~5=10/20/30/40/50개, 6=PERFECT)
--   • is_passed/correct_count 제거 → tier_level/correct_words 로 대체
--   • 모든 시도 보존 (학습 데이터 자산)
--   • 회차별 랭킹·등급 분포 view 추가
--
-- 전제:
--   • 회원 시스템은 구서버(PHP)가 소유 — Supabase Auth는 사용 안 함
--   • 구서버 → 학생 브라우저로 JWT 발급 (1시간, 자동 갱신)
--   • JWT payload: { member_no, name, school_level, grade, center, iat, exp }
--   • 학생 브라우저 → Supabase 직접 호출 시 JWT 첨부 (Authorization: Bearer)
--   • Supabase는 RLS에서 JWT의 member_no 검증
--
-- 적용 순서:
--   1) 01_content_schema.sql  (Phase 1 — 이미 적용됨)
--   2) 02_seed_areas.sql       (Phase 1 — 이미 적용됨)
--   3) 03_records_schema.sql   ← 이 파일
-- ════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════
-- 1. user_profile_cache (학생 정보 사본 — 구서버에서 동기화)
-- ════════════════════════════════════════
CREATE TABLE user_profile_cache (
  member_no         BIGINT PRIMARY KEY,            -- 구서버 회원 번호 (JWT의 member_no)
  name              TEXT NOT NULL,                 -- 학생 이름
  school_level      TEXT CHECK (school_level IN ('초','중','고')),
  grade             SMALLINT CHECK (grade BETWEEN 1 AND 6),
  center            TEXT,                          -- 센터명 (예: '강남센터')
  last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE  user_profile_cache              IS '구서버 학생 정보 캐시 — 24h마다 갱신';
COMMENT ON COLUMN user_profile_cache.member_no    IS '구서버 회원 번호 (안정 PK)';
COMMENT ON COLUMN user_profile_cache.school_level IS '학교급: 초/중/고';
COMMENT ON COLUMN user_profile_cache.grade        IS '학년 (1~6) — 표시는 school_level || grade';
CREATE INDEX idx_profile_cache_school_grade ON user_profile_cache (school_level, grade);
CREATE INDEX idx_profile_cache_center       ON user_profile_cache (center);


-- ════════════════════════════════════════
-- 2. attempts (회차 시도 — 한 학생이 한 회차 한 번 시도 = 1행)
--   • 모든 시도 보존 (재시도 포함)
--   • 단계별 점수 + 단계 진행 상태 + 등급
--   • finished_at NULL = 진행 중 (이어가기 가능)
-- ════════════════════════════════════════
CREATE TABLE attempts (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_no         BIGINT NOT NULL,
  session_id        BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  area_id           BIGINT NOT NULL REFERENCES areas(id),     -- 비정규화 (랭킹·통계 빠르게)

  attempt_no        SMALLINT NOT NULL DEFAULT 1,              -- N번째 시도 (트리거 자동)

  current_stage     TEXT NOT NULL DEFAULT 'retrieve'          -- 현재 단계
                    CHECK (current_stage IN ('retrieve','extend','reinforce','done')),

  -- 단계별 점수
  retrieve_count    SMALLINT,                                 -- 인출 통과 어휘 수
  extend_count      SMALLINT,                                 -- 확장 통과 어휘 수
  correct_words     SMALLINT,                                 -- 강화 정답 어휘 수 (tier 결정 기준)

  total_words       SMALLINT NOT NULL,                        -- 회차 총 어휘 수
  tier_level        SMALLINT NOT NULL DEFAULT 0               -- 0=미통과 / 1~5=10/20/30/40/50 / 6=PERFECT
                    CHECK (tier_level BETWEEN 0 AND 6),

  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ,                              -- NULL=진행중 (이어가기 대상)
  duration_sec      INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE  attempts                IS '회차 시도 기록 — 모든 시도 보존, 단계별 점수·등급 포함';
COMMENT ON COLUMN attempts.attempt_no     IS '같은 (member, session)에서 N번째 시도 (트리거 자동)';
COMMENT ON COLUMN attempts.current_stage  IS 'retrieve/extend/reinforce/done — 단계 단위 이어가기 기준점';
COMMENT ON COLUMN attempts.tier_level     IS '0=미통과, 1=10+, 2=20+, 3=30+, 4=40+, 5=50+, 6=PERFECT(전부)';
COMMENT ON COLUMN attempts.correct_words  IS '강화 단계 정답 어휘 수 — tier_level 계산 입력값';

CREATE INDEX idx_attempts_member_session   ON attempts (member_no, session_id, attempt_no DESC);
CREATE INDEX idx_attempts_member_area      ON attempts (member_no, area_id);
CREATE INDEX idx_attempts_session_tier     ON attempts (session_id, tier_level DESC);
CREATE INDEX idx_attempts_in_progress      ON attempts (member_no, session_id) WHERE finished_at IS NULL;


-- ════════════════════════════════════════
-- 3. word_results (어휘별 단계별 결과 — attempts 자식)
--   • 어휘당 1행, 인출/확장/강화 단계별 결과를 컬럼으로
--   • NULL = 그 단계 미노출 (예: 인출 통과한 어휘는 extend_passed=NULL)
-- ════════════════════════════════════════
CREATE TABLE word_results (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id        BIGINT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  member_no         BIGINT NOT NULL,
  session_word_id   BIGINT NOT NULL REFERENCES session_words(id) ON DELETE CASCADE,
  word_master_id    BIGINT NOT NULL REFERENCES word_master(id),

  retrieve_passed   BOOLEAN,                                  -- 인출에서 떠올림? (NULL=미시도)
  extend_passed     BOOLEAN,                                  -- 확장에서 깨움? (NULL=노출 안됨)
  reinforce_passed  BOOLEAN,                                  -- 강화 정답? (NULL=노출 안됨)
  reinforce_choice  TEXT,                                     -- 강화에서 선택한 보기 (오답 분석)

  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (attempt_id, session_word_id)
);
COMMENT ON TABLE  word_results               IS '어휘별 단계별 결과 — 어휘당 1행';
COMMENT ON COLUMN word_results.retrieve_passed  IS '인출에서 떠올림? (NULL=미시도)';
COMMENT ON COLUMN word_results.extend_passed    IS '확장에서 깨움? (NULL=노출 안됨, 인출 통과 어휘)';
COMMENT ON COLUMN word_results.reinforce_passed IS '강화 빈칸 정답? (NULL=강화까지 도달 안함)';

CREATE INDEX idx_word_results_attempt        ON word_results (attempt_id);
CREATE INDEX idx_word_results_member_word    ON word_results (member_no, word_master_id, recorded_at DESC);
CREATE INDEX idx_word_results_word_wrong     ON word_results (word_master_id) WHERE reinforce_passed = false;


-- ════════════════════════════════════════
-- 4. area_progress (학생×영역 진행도 — 캐시값)
--   • cleared_count: tier_level >= 1 인 회차 수 (DISTINCT session)
--   • 단계별 카운트(tier1~tier5, perfect)는 캐시 안 함 → query on demand
-- ════════════════════════════════════════
CREATE TABLE area_progress (
  member_no         BIGINT NOT NULL,
  area_id           BIGINT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  cleared_count     SMALLINT NOT NULL DEFAULT 0,              -- tier ≥ 1 회차 수 (통과)
  total_attempts    INTEGER NOT NULL DEFAULT 0,               -- 누적 시도 횟수 (재시도 포함)
  last_session_id   BIGINT REFERENCES sessions(id),
  last_attempt_at   TIMESTAMPTZ,
  PRIMARY KEY (member_no, area_id)
);
COMMENT ON TABLE area_progress IS '학생×영역 진행도 — cleared_count만 캐시. 단계별 분포는 v_area_tier_distribution view 참조';
CREATE INDEX idx_area_progress_area_count ON area_progress (area_id, cleared_count DESC);


-- ════════════════════════════════════════
-- 5. 트리거 — attempt_no 자동 부여 (BEFORE INSERT)
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_attempt_no()
RETURNS TRIGGER AS $$
BEGIN
  -- DEFAULT 1 적용된 신규 row만 자동 계산 (명시적 attempt_no 지정 시 그대로 사용)
  IF NEW.attempt_no IS NULL OR NEW.attempt_no = 1 THEN
    NEW.attempt_no := COALESCE(
      (SELECT MAX(attempt_no) + 1
       FROM attempts
       WHERE member_no = NEW.member_no AND session_id = NEW.session_id),
      1
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_attempt_no
  BEFORE INSERT ON attempts
  FOR EACH ROW EXECUTE FUNCTION set_attempt_no();


-- ════════════════════════════════════════
-- 6. 트리거 — attempts 변경 시 area_progress 자동 갱신
--   tier_level >= 1 인 distinct session 수 = cleared_count
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION refresh_area_progress()
RETURNS TRIGGER AS $$
DECLARE
  v_member BIGINT;
  v_area   BIGINT;
BEGIN
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
    COUNT(DISTINCT a.session_id) FILTER (WHERE a.tier_level >= 1)::SMALLINT,
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
  AFTER INSERT OR UPDATE OF tier_level, finished_at OR DELETE
  ON attempts
  FOR EACH ROW EXECUTE FUNCTION refresh_area_progress();


-- ════════════════════════════════════════
-- 7. RLS (Row Level Security) — JWT 기반
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

-- 자기 attempts UPDATE (단계 전환·결과 마무리)
CREATE POLICY "own_update" ON attempts
  FOR UPDATE USING (member_no = (current_setting('request.jwt.claims', true)::json->>'member_no')::BIGINT);

-- 자기 word_results UPDATE (단계별 결과 누적 채움)
CREATE POLICY "own_update" ON word_results
  FOR UPDATE USING (member_no = (current_setting('request.jwt.claims', true)::json->>'member_no')::BIGINT);

-- user_profile_cache·area_progress의 INSERT/UPDATE는 service_role 또는 트리거만


-- ════════════════════════════════════════
-- 8. View: v_session_best_tier
--   학생×회차의 최고 등급 (재시도 포함, 가장 좋은 성적)
--   훈사전 셀 색상 결정에 사용
-- ════════════════════════════════════════
CREATE OR REPLACE VIEW v_session_best_tier AS
SELECT
  member_no,
  session_id,
  area_id,
  MAX(tier_level)              AS best_tier,
  MAX(correct_words)           AS best_correct,
  COUNT(*)                     AS attempts_count,
  MIN(attempt_no) FILTER (WHERE tier_level >= 1) AS first_pass_attempt_no
FROM attempts
WHERE tier_level IS NOT NULL
GROUP BY member_no, session_id, area_id;

COMMENT ON VIEW v_session_best_tier IS '학생×회차 최고 등급 + 첫 통과까지 시도 수 — 훈사전 셀 표시용';
GRANT SELECT ON v_session_best_tier TO anon, authenticated;


-- ════════════════════════════════════════
-- 9. View: v_session_ranking
--   회차별 랭킹 (오늘의 회차 + 이전 회차 모두)
--   학생들의 최고 등급·정답 수 기준 순위
-- ════════════════════════════════════════
CREATE OR REPLACE VIEW v_session_ranking AS
SELECT
  s.session_id,
  s.area_id,
  s.member_no,
  upc.name,
  upc.school_level,
  upc.grade,
  upc.center,
  s.best_tier,
  s.best_correct,
  s.attempts_count,
  RANK() OVER (
    PARTITION BY s.session_id
    ORDER BY s.best_tier DESC, s.best_correct DESC
  ) AS rank
FROM v_session_best_tier s
LEFT JOIN user_profile_cache upc ON upc.member_no = s.member_no
WHERE s.best_tier >= 1;

COMMENT ON VIEW v_session_ranking IS '회차별 랭킹 — 등급·정답수 기준. 클라이언트는 session_id 필터 + LIMIT 100';
GRANT SELECT ON v_session_ranking TO anon, authenticated;


-- ════════════════════════════════════════
-- 10. View: v_area_tier_distribution
--   학생×영역의 등급 분포 (현황 페이지용)
--   각 영역에서 1단계~PERFECT 회차가 몇 개씩인지
-- ════════════════════════════════════════
CREATE OR REPLACE VIEW v_area_tier_distribution AS
SELECT
  member_no,
  area_id,
  COUNT(*) FILTER (WHERE best_tier = 1)::SMALLINT AS tier1_count,
  COUNT(*) FILTER (WHERE best_tier = 2)::SMALLINT AS tier2_count,
  COUNT(*) FILTER (WHERE best_tier = 3)::SMALLINT AS tier3_count,
  COUNT(*) FILTER (WHERE best_tier = 4)::SMALLINT AS tier4_count,
  COUNT(*) FILTER (WHERE best_tier = 5)::SMALLINT AS tier5_count,
  COUNT(*) FILTER (WHERE best_tier = 6)::SMALLINT AS perfect_count,
  COUNT(*)::SMALLINT                              AS cleared_count
FROM v_session_best_tier
WHERE best_tier >= 1
GROUP BY member_no, area_id;

COMMENT ON VIEW v_area_tier_distribution IS '학생×영역 등급 분포 — 현황 페이지에서 영역별 카드에 표시';
GRANT SELECT ON v_area_tier_distribution TO authenticated;


-- ════════════════════════════════════════
-- 11. View: v_area_ranking
--   영역별 랭킹 — 통과 회차 수(cleared_count) 기준
--   PERFECT 수가 동률 시 tiebreaker
-- ════════════════════════════════════════
CREATE OR REPLACE VIEW v_area_ranking AS
SELECT
  ap.area_id,
  ap.member_no,
  upc.name,
  upc.school_level,
  upc.grade,
  upc.center,
  ap.cleared_count,
  COALESCE(td.perfect_count, 0::SMALLINT) AS perfect_count,
  RANK() OVER (
    PARTITION BY ap.area_id
    ORDER BY ap.cleared_count DESC, COALESCE(td.perfect_count, 0) DESC
  ) AS rank
FROM area_progress ap
LEFT JOIN user_profile_cache upc      ON upc.member_no = ap.member_no
LEFT JOIN v_area_tier_distribution td ON td.member_no = ap.member_no AND td.area_id = ap.area_id
WHERE ap.cleared_count > 0;

COMMENT ON VIEW v_area_ranking IS '영역별 랭킹 — 통과 회차 수(주) + PERFECT 수(부). 클라이언트는 area_id 필터 + LIMIT 100';
GRANT SELECT ON v_area_ranking TO anon, authenticated;


-- ════════════════════════════════════════
-- 끝.
-- 다음 단계:
--   • 구서버(PHP)에서 JWT 발급: POST /api/auth/issue-jwt
--     payload: { member_no, name, school_level, grade, center, iat, exp }
--   • Supabase 프로젝트 → Auth → JWT Secret을 구서버 시크릿과 동일하게 설정
--   • 프론트:
--     - 회차 진입 시: 미완료 attempt 조회 → 있으면 current_stage로 이어가기
--     - 단계 전환 시: attempts.current_stage UPDATE + word_results 일괄 INSERT/UPDATE
--     - 회차 완료 시: tier_level 계산, finished_at, current_stage='done'
-- ════════════════════════════════════════
