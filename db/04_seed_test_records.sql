-- ════════════════════════════════════════════════════════════════
-- 훈감각 익히기 — Phase 2 더미 데이터 검증 스크립트
-- Date: 2026-05-04
--
-- 목적:
--   • Phase 2 스키마(03_records_schema.sql) 적용 후 동작 검증
--   • 가상 학생 5명 + 회차 시도 + 어휘 응답 더미 데이터 생성
--   • 트리거가 area_progress 자동 갱신하는지 확인
--   • 랭킹 view가 정렬 잘 되는지 확인
--
-- 실행 전제:
--   • 01_content_schema.sql, 02_seed_areas.sql 적용됨
--   • 03_records_schema.sql 적용됨
--   • 생물 1회차(生), 2회차(體) 콘텐츠 존재
--
-- 주의:
--   • Supabase SQL Editor에서 실행 시 service_role 권한이라 RLS 우회됨
--   • 검증 끝나면 마지막 ROLLBACK 또는 TRUNCATE 섹션으로 초기화
-- ════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════
-- 1. 가상 학생 5명 — user_profile_cache
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
--   • 김훈수: 1회차 패스, 2회차 패스 (2회차 마스터)
--   • 이지수: 1회차 패스, 2회차 시도하다 실패
--   • 박민재: 1회차 패스만
--   • 최소은: 1회차 시도 → 실패 → 재시도 → 패스, 2회차 패스
--   • 정태호: 시도 없음 (랭킹에 안 나타나야 함)
-- ════════════════════════════════════════

-- 영역·회차 ID 조회 (CTE로 묶어서 INSERT)
WITH
  bio AS (SELECT id AS area_id FROM areas WHERE slug = 'biology'),
  s1  AS (SELECT id AS session_id, (SELECT area_id FROM bio) AS area_id FROM sessions WHERE area_id = (SELECT area_id FROM bio) AND round_no = 1),
  s2  AS (SELECT id AS session_id, (SELECT area_id FROM bio) AS area_id FROM sessions WHERE area_id = (SELECT area_id FROM bio) AND round_no = 2)
INSERT INTO attempts (member_no, session_id, area_id, started_at, finished_at, duration_sec, total_words, correct_count, is_passed)
-- 김훈수: 1회차 패스
SELECT 10001, s1.session_id, s1.area_id, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '5 min', 300, 42, 38, true FROM s1
UNION ALL
-- 김훈수: 2회차 패스
SELECT 10001, s2.session_id, s2.area_id, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '6 min', 360, 51, 45, true FROM s2
UNION ALL
-- 이지수: 1회차 패스
SELECT 10002, s1.session_id, s1.area_id, NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days' + INTERVAL '7 min', 420, 42, 35, true FROM s1
UNION ALL
-- 이지수: 2회차 실패
SELECT 10002, s2.session_id, s2.area_id, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' + INTERVAL '8 min', 480, 51, 25, false FROM s2
UNION ALL
-- 박민재: 1회차 패스
SELECT 10003, s1.session_id, s1.area_id, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '9 min', 540, 42, 36, true FROM s1
UNION ALL
-- 최소은: 1회차 1차 시도 실패
SELECT 10004, s1.session_id, s1.area_id, NOW() - INTERVAL '6 days', NOW() - INTERVAL '6 days' + INTERVAL '10 min', 600, 42, 20, false FROM s1
UNION ALL
-- 최소은: 1회차 2차 시도 패스
SELECT 10004, s1.session_id, s1.area_id, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '6 min', 360, 42, 39, true FROM s1
UNION ALL
-- 최소은: 2회차 패스
SELECT 10004, s2.session_id, s2.area_id, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '5 min', 300, 51, 47, true FROM s2;


-- ════════════════════════════════════════
-- 3. 검증 쿼리 — 트리거가 area_progress 갱신했는지
-- ════════════════════════════════════════

-- 예상:
--   김훈수 (10001): 생물 cleared_count=2, total_attempts=2
--   이지수 (10002): 생물 cleared_count=1, total_attempts=2
--   박민재 (10003): 생물 cleared_count=1, total_attempts=1
--   최소은 (10004): 생물 cleared_count=2, total_attempts=3
--   정태호 (10005): area_progress 행 없음
SELECT
  upc.name,
  upc.school_level || upc.grade AS class,
  ap.area_id,
  ap.cleared_count,
  ap.total_attempts,
  ap.last_attempt_at::DATE AS last_date
FROM area_progress ap
JOIN user_profile_cache upc ON upc.member_no = ap.member_no
ORDER BY upc.member_no, ap.area_id;


-- ════════════════════════════════════════
-- 4. 검증 쿼리 — 랭킹 view
-- ════════════════════════════════════════

-- 예상 (생물 영역):
--   1위: 김훈수 cleared=2  (이름순 또는 순서대로)
--   1위: 최소은 cleared=2  (동률)
--   3위: 이지수 cleared=1
--   3위: 박민재 cleared=1
--   정태호: 없음 (cleared_count=0)
SELECT
  rank,
  name,
  school_level || grade AS class,
  center,
  cleared_count
FROM v_area_ranking
WHERE area_id = (SELECT id FROM areas WHERE slug = 'biology')
ORDER BY rank, name;


-- ════════════════════════════════════════
-- 5. 검증 쿼리 — RLS 동작 확인 (선택)
--   • SQL Editor는 service_role이라 RLS 우회 → 모두 보임
--   • 실제 검증은 클라이언트에서 anon key + JWT로 호출 시 가능
--   • 여기선 정책 존재만 확인
-- ════════════════════════════════════════
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('user_profile_cache', 'attempts', 'word_results', 'area_progress')
ORDER BY tablename, policyname;


-- ════════════════════════════════════════
-- 6. 정리 (검증 끝나면 실행 — 더미 데이터 삭제)
-- ════════════════════════════════════════

-- 더미 학생만 정리하고 싶으면:
-- DELETE FROM attempts WHERE member_no BETWEEN 10001 AND 10005;
-- DELETE FROM area_progress WHERE member_no BETWEEN 10001 AND 10005;
-- DELETE FROM user_profile_cache WHERE member_no BETWEEN 10001 AND 10005;

-- 또는 전체 학습 기록 초기화:
-- TRUNCATE word_results, attempts, area_progress, user_profile_cache RESTART IDENTITY CASCADE;
