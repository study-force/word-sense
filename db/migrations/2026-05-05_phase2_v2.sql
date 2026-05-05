-- ════════════════════════════════════════════════════════════════
-- Migration: Phase 2 v1.x → v2.0
-- Date: 2026-05-05
--
-- 변경 내용:
--   • attempts: 단계별 점수·등급·이어가기 컬럼 추가, is_passed/correct_count 제거
--   • word_results: 단계별 결과 컬럼으로 재작성 (DROP/CREATE)
--   • area_progress: 트리거 로직만 변경 (cleared_count = tier_level >= 1)
--   • set_attempt_no 트리거 신규
--   • 4개 view 추가 (v_session_best_tier, v_session_ranking, v_area_tier_distribution, v_area_ranking 갱신)
--
-- 적용:
--   Supabase Studio → SQL Editor → 이 파일 RUN
--   (실행 전 더미 데이터 정리 권장 — 04_seed_test_records.sql 섹션 6 실행)
-- ════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════
-- 0. 안전 장치 — 더미 데이터 잔존 시 정리
-- ════════════════════════════════════════
DELETE FROM word_results WHERE member_no BETWEEN 10001 AND 10005;
DELETE FROM attempts     WHERE member_no BETWEEN 10001 AND 10005;
DELETE FROM area_progress WHERE member_no BETWEEN 10001 AND 10005;
DELETE FROM user_profile_cache WHERE member_no BETWEEN 10001 AND 10005;


-- ════════════════════════════════════════
-- 1. 기존 트리거·view 제거 (재생성 위해)
-- ════════════════════════════════════════
DROP TRIGGER  IF EXISTS trg_attempts_refresh_progress ON attempts;
DROP FUNCTION IF EXISTS refresh_area_progress() CASCADE;
DROP VIEW     IF EXISTS v_area_ranking CASCADE;


-- ════════════════════════════════════════
-- 2. attempts — 컬럼 변경
-- ════════════════════════════════════════
-- 기존 컬럼 제거
ALTER TABLE attempts DROP COLUMN IF EXISTS correct_count;
ALTER TABLE attempts DROP COLUMN IF EXISTS is_passed;

-- 신규 컬럼 추가
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS attempt_no SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS current_stage TEXT NOT NULL DEFAULT 'retrieve'
  CHECK (current_stage IN ('retrieve','extend','reinforce','done'));

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS retrieve_count SMALLINT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS extend_count   SMALLINT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS correct_words  SMALLINT;

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS tier_level SMALLINT NOT NULL DEFAULT 0
  CHECK (tier_level BETWEEN 0 AND 6);

-- 코멘트 갱신
COMMENT ON TABLE  attempts                IS '회차 시도 기록 — 모든 시도 보존, 단계별 점수·등급 포함';
COMMENT ON COLUMN attempts.attempt_no     IS '같은 (member, session)에서 N번째 시도 (트리거 자동)';
COMMENT ON COLUMN attempts.current_stage  IS 'retrieve/extend/reinforce/done — 단계 단위 이어가기 기준점';
COMMENT ON COLUMN attempts.tier_level     IS '0=미통과, 1=10+, 2=20+, 3=30+, 4=40+, 5=50+, 6=PERFECT(전부)';
COMMENT ON COLUMN attempts.correct_words  IS '강화 단계 정답 어휘 수 — tier_level 계산 입력값';

-- 인덱스 갱신
DROP INDEX IF EXISTS idx_attempts_member_session;
DROP INDEX IF EXISTS idx_attempts_session;

CREATE INDEX IF NOT EXISTS idx_attempts_member_session ON attempts (member_no, session_id, attempt_no DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_session_tier   ON attempts (session_id, tier_level DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_in_progress    ON attempts (member_no, session_id) WHERE finished_at IS NULL;


-- ════════════════════════════════════════
-- 3. word_results — DROP/CREATE
--   (현재 비어 있어 안전. 기존 schema의 is_correct/selected_choice/answered_at → 신 schema 컬럼들)
-- ════════════════════════════════════════
DROP TABLE IF EXISTS word_results CASCADE;

CREATE TABLE word_results (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id        BIGINT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  member_no         BIGINT NOT NULL,
  session_word_id   BIGINT NOT NULL REFERENCES session_words(id) ON DELETE CASCADE,
  word_master_id    BIGINT NOT NULL REFERENCES word_master(id),

  retrieve_passed   BOOLEAN,
  extend_passed     BOOLEAN,
  reinforce_passed  BOOLEAN,
  reinforce_choice  TEXT,

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

-- RLS 재설정
ALTER TABLE word_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_select" ON word_results
  FOR SELECT USING (member_no = (current_setting('request.jwt.claims', true)::json->>'member_no')::BIGINT);

CREATE POLICY "own_insert" ON word_results
  FOR INSERT WITH CHECK (member_no = (current_setting('request.jwt.claims', true)::json->>'member_no')::BIGINT);

CREATE POLICY "own_update" ON word_results
  FOR UPDATE USING (member_no = (current_setting('request.jwt.claims', true)::json->>'member_no')::BIGINT);


-- ════════════════════════════════════════
-- 4. attempt_no 자동 트리거 (BEFORE INSERT)
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_attempt_no()
RETURNS TRIGGER AS $$
BEGIN
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

DROP TRIGGER IF EXISTS trg_set_attempt_no ON attempts;
CREATE TRIGGER trg_set_attempt_no
  BEFORE INSERT ON attempts
  FOR EACH ROW EXECUTE FUNCTION set_attempt_no();


-- ════════════════════════════════════════
-- 5. area_progress 트리거 재생성 (tier_level 기반)
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
-- 6. View 신규/재생성
-- ════════════════════════════════════════

-- 학생×회차 최고 등급
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


-- 회차별 랭킹
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

COMMENT ON VIEW v_session_ranking IS '회차별 랭킹 — 등급·정답수 기준';
GRANT SELECT ON v_session_ranking TO anon, authenticated;


-- 학생×영역 등급 분포 (현황 페이지)
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

COMMENT ON VIEW v_area_tier_distribution IS '학생×영역 등급 분포 — 현황 페이지용';
GRANT SELECT ON v_area_tier_distribution TO authenticated;


-- 영역별 랭킹 (재생성)
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

COMMENT ON VIEW v_area_ranking IS '영역별 랭킹 — 통과 회차 수 + PERFECT 수';
GRANT SELECT ON v_area_ranking TO anon, authenticated;


-- ════════════════════════════════════════
-- 7. 적용 확인
-- ════════════════════════════════════════
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name IN ('attempts','word_results','area_progress','user_profile_cache')
  AND table_schema = 'public'
ORDER BY table_name, ordinal_position;
