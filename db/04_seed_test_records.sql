-- ════════════════════════════════════════════════════════════════
-- 훈감각 익히기 — Phase 2 v2.0 더미 데이터 검증 스크립트
-- Date: 2026-05-05
--
-- 목적:
--   • Phase 2 v2.0 스키마 적용 후 동작 검증
--   • 가상 학생 5명 + 단계별 점수·등급·재시도 케이스 포함
--   • 트리거(set_attempt_no, refresh_area_progress) 동작 확인
--   • 4개 view (v_session_best_tier, v_session_ranking, v_area_tier_distribution, v_area_ranking) 검증
--
-- 등급 케이스 커버:
--   • PERFECT (tier 6): 김훈수 1회차, 최소은 2회차
--   • tier 4 (40+): 김훈수 2회차 2차
--   • tier 3 (30+): 이지수 1회차, 최소은 1회차 2차
--   • tier 2 (20+): 박민재 1회차
--   • tier 0 (미통과): 최소은 1회차 1차
--   • 재시도 시나리오: 김훈수 2회차 (1차→2차), 최소은 1회차 (1차→2차)
-- ════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════
-- 1. 학생 5명 — user_profile_cache
-- ════════════════════════════════════════
INSERT INTO user_profile_cache (member_no, name, school_level, grade, center) VALUES
  (10001, '김훈수', '초', 6, '강남센터'),
  (10002, '이지수', '초', 5, '강남센터'),
  (10003, '박민재', '중', 1, '분당센터'),
  (10004, '최소은', '중', 2, '분당센터'),
  (10005, '정태호', '고', 1, '강남센터')
ON CONFLICT (member_no) DO UPDATE SET
  name = EXCLUDED.name,
  school_level = EXCLUDED.school_level,
  grade = EXCLUDED.grade,
  center = EXCLUDED.center,
  last_synced_at = NOW();


-- ════════════════════════════════════════
-- 2. 회차 시도 — attempts
--   total_words: 1회차(生) 42개, 2회차(體) 51개 가정
--   attempt_no는 트리거가 자동 부여
-- ════════════════════════════════════════
WITH
  bio AS (SELECT id AS area_id FROM areas WHERE slug = 'biology'),
  s1  AS (SELECT id AS session_id, (SELECT area_id FROM bio) AS area_id FROM sessions
            WHERE area_id = (SELECT area_id FROM bio) AND round_no = 1),
  s2  AS (SELECT id AS session_id, (SELECT area_id FROM bio) AS area_id FROM sessions
            WHERE area_id = (SELECT area_id FROM bio) AND round_no = 2)
INSERT INTO attempts (
  member_no, session_id, area_id,
  current_stage, retrieve_count, extend_count, correct_words, total_words, tier_level,
  started_at, finished_at, duration_sec
)
-- 김훈수 1회차: PERFECT (42/42)
SELECT 10001, s1.session_id, s1.area_id,
  'done', 35, 7, 42, 42, 6,
  NOW() - INTERVAL '4 days',
  NOW() - INTERVAL '4 days' + INTERVAL '6 min', 360
FROM s1
UNION ALL
-- 김훈수 2회차 1차: tier 3 (30/51)
SELECT 10001, s2.session_id, s2.area_id,
  'done', 25, 10, 30, 51, 3,
  NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '3 days' + INTERVAL '7 min', 420
FROM s2
UNION ALL
-- 김훈수 2회차 2차: tier 4 (48/51, 성장)
SELECT 10001, s2.session_id, s2.area_id,
  'done', 33, 12, 48, 51, 4,
  NOW() - INTERVAL '2 days',
  NOW() - INTERVAL '2 days' + INTERVAL '6 min', 360
FROM s2
UNION ALL
-- 이지수 1회차: tier 3 (35/42)
SELECT 10002, s1.session_id, s1.area_id,
  'done', 28, 10, 35, 42, 3,
  NOW() - INTERVAL '5 days',
  NOW() - INTERVAL '5 days' + INTERVAL '8 min', 480
FROM s1
UNION ALL
-- 박민재 1회차: tier 2 (22/42)
SELECT 10003, s1.session_id, s1.area_id,
  'done', 15, 8, 22, 42, 2,
  NOW() - INTERVAL '5 days',
  NOW() - INTERVAL '5 days' + INTERVAL '9 min', 540
FROM s1
UNION ALL
-- 최소은 1회차 1차: tier 0 미통과 (8/42)
SELECT 10004, s1.session_id, s1.area_id,
  'done', 5, 3, 8, 42, 0,
  NOW() - INTERVAL '6 days',
  NOW() - INTERVAL '6 days' + INTERVAL '10 min', 600
FROM s1
UNION ALL
-- 최소은 1회차 2차: tier 3 (39/42, 회복)
SELECT 10004, s1.session_id, s1.area_id,
  'done', 30, 9, 39, 42, 3,
  NOW() - INTERVAL '5 days',
  NOW() - INTERVAL '5 days' + INTERVAL '7 min', 420
FROM s1
UNION ALL
-- 최소은 2회차: PERFECT (51/51)
SELECT 10004, s2.session_id, s2.area_id,
  'done', 38, 13, 51, 51, 6,
  NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '3 days' + INTERVAL '5 min', 300
FROM s2;


-- ════════════════════════════════════════
-- 3. 검증 1 — attempt_no 트리거 (자동 부여)
-- ════════════════════════════════════════
-- 예상:
--   김훈수 1회차: attempt_no=1 (1번째)
--   김훈수 2회차: 1차=1, 2차=2
--   최소은 1회차: 1차=1, 2차=2
--   최소은 2회차: attempt_no=1
SELECT
  upc.name,
  s.round_no,
  a.attempt_no,
  a.tier_level,
  a.correct_words || '/' || a.total_words AS score
FROM attempts a
JOIN user_profile_cache upc ON upc.member_no = a.member_no
JOIN sessions s             ON s.id = a.session_id
ORDER BY a.member_no, s.round_no, a.attempt_no;


-- ════════════════════════════════════════
-- 4. 검증 2 — area_progress 트리거 (자동 갱신)
-- ════════════════════════════════════════
-- 예상:
--   김훈수: cleared=2 (1·2회차 통과), total=3 (시도 3건)
--   이지수: cleared=1, total=1
--   박민재: cleared=1, total=1
--   최소은: cleared=2 (1회차는 2차에 통과+2회차 통과), total=3
SELECT
  upc.name,
  upc.school_level || upc.grade AS class,
  ap.cleared_count,
  ap.total_attempts,
  ap.last_attempt_at::DATE AS last_date
FROM area_progress ap
JOIN user_profile_cache upc ON upc.member_no = ap.member_no
ORDER BY upc.member_no;


-- ════════════════════════════════════════
-- 5. 검증 3 — v_session_best_tier (학생×회차 최고 등급)
-- ════════════════════════════════════════
-- 예상:
--   김훈수 1회차: best_tier=6, attempts=1, first_pass=1
--   김훈수 2회차: best_tier=4, attempts=2, first_pass=1
--   최소은 1회차: best_tier=3, attempts=2, first_pass=2 (2번째에 통과)
--   최소은 2회차: best_tier=6, attempts=1, first_pass=1
SELECT
  upc.name,
  s.round_no,
  v.best_tier,
  v.best_correct,
  v.attempts_count,
  v.first_pass_attempt_no AS first_pass
FROM v_session_best_tier v
JOIN user_profile_cache upc ON upc.member_no = v.member_no
JOIN sessions s             ON s.id = v.session_id
ORDER BY v.member_no, s.round_no;


-- ════════════════════════════════════════
-- 6. 검증 4 — v_session_ranking (회차별 랭킹)
-- ════════════════════════════════════════
-- 1회차 예상 (best_tier DESC, best_correct DESC):
--   1위 김훈수 (PERFECT, 42)
--   2위 최소은 (tier 3, 39)
--   3위 이지수 (tier 3, 35)
--   4위 박민재 (tier 2, 22)
SELECT
  s.round_no,
  v.rank,
  v.name,
  v.best_tier,
  v.best_correct,
  v.attempts_count
FROM v_session_ranking v
JOIN sessions s ON s.id = v.session_id
ORDER BY s.round_no, v.rank;


-- ════════════════════════════════════════
-- 7. 검증 5 — v_area_tier_distribution (등급 분포)
-- ════════════════════════════════════════
-- 생물 영역 예상:
--   김훈수: tier3=1, tier4=1, perfect=1, cleared=3 ❗
--                  Wait — 1회차 perfect=1, 2회차 best=tier4 (1차 tier3은 무시)
--                  → tier4=1, perfect=1, cleared=2
SELECT
  upc.name,
  td.tier1_count, td.tier2_count, td.tier3_count,
  td.tier4_count, td.tier5_count, td.perfect_count,
  td.cleared_count
FROM v_area_tier_distribution td
JOIN user_profile_cache upc ON upc.member_no = td.member_no
ORDER BY upc.member_no;


-- ════════════════════════════════════════
-- 8. 검증 6 — v_area_ranking (영역 랭킹)
-- ════════════════════════════════════════
-- 생물 예상 (cleared DESC, perfect DESC):
--   1위 김훈수 (cleared=2, perfect=1)
--   1위 최소은 (cleared=2, perfect=1) — 동률
--   3위 이지수 (cleared=1, perfect=0)
--   3위 박민재 (cleared=1, perfect=0)
SELECT
  v.rank,
  v.name,
  v.school_level || v.grade AS class,
  v.center,
  v.cleared_count,
  v.perfect_count
FROM v_area_ranking v
WHERE v.area_id = (SELECT id FROM areas WHERE slug = 'biology')
ORDER BY v.rank, v.name;


-- ════════════════════════════════════════
-- 9. 검증 7 — RLS 정책 확인
-- ════════════════════════════════════════
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('user_profile_cache','attempts','word_results','area_progress')
ORDER BY tablename, policyname;


-- ════════════════════════════════════════
-- 10. 정리 (검증 끝나면 주석 풀고 실행)
-- ════════════════════════════════════════

-- 더미 학생만 정리:
-- DELETE FROM word_results   WHERE member_no BETWEEN 10001 AND 10005;
-- DELETE FROM attempts       WHERE member_no BETWEEN 10001 AND 10005;
-- DELETE FROM area_progress  WHERE member_no BETWEEN 10001 AND 10005;
-- DELETE FROM user_profile_cache WHERE member_no BETWEEN 10001 AND 10005;

-- 또는 전체 학습 기록 초기화:
-- TRUNCATE word_results, attempts, area_progress, user_profile_cache RESTART IDENTITY CASCADE;
