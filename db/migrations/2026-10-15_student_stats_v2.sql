-- ════════════════════════════════════════════════════════════════
-- 학생 통계(영역별 훈련 현황 · 등급별 어휘 습득률) 집계 함수
-- 2026-10-15: 중등 분모 = 主字가 들어간 초등 어휘 전부 (앱 data-supabase.js 3b와 동일)
--   호출: Edge Function wordsense-stats (service_role) 전용. anon/authenticated 실행 불가.
--
-- 정의 (대표님 확정 2026-10-14)
--   습득(분자) = 인출 또는 확장에서 맞힌 어휘 (word_results.retrieve_passed OR extend_passed).
--               오답 후 정답(검정 칩)은 기록 안 됨 → 미포함.
--   전체(분모) = 해당 학제 회차에 실제 출제되는 어휘. 중등은 같은 主字 초등 회차 어휘까지 합침
--               (앱 data-supabase.js 3b와 동일).
--   등급별     = 학생이 응시한 회차에서 제공된 어휘(provided) 중 습득 비율.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.wordsense_student_stats(p_member_no bigint, p_level text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
WITH lvl_sess AS (
  SELECT id, area_id, main_char FROM sessions WHERE level = p_level
),
sess_words AS (            -- 회차별 실제 출제 어휘
  SELECT s.id AS session_id, s.area_id, sw.word_master_id
  FROM lvl_sess s JOIN session_words sw ON sw.session_id = s.id
  UNION
  SELECT s.id, s.area_id, sw.word_master_id      -- 중등: 主字가 들어간 초등 어휘 전부 (2026-10-15 확장)
  FROM lvl_sess s
  JOIN word_master w ON p_level = '중등' AND position(s.main_char in w.hanja) > 0
  JOIN session_words sw ON sw.word_master_id = w.id
  JOIN sessions e ON e.id = sw.session_id AND e.level = '초등'
),
area_total AS (
  SELECT area_id, count(DISTINCT word_master_id) AS total FROM sess_words GROUP BY 1
),
my_att AS (
  SELECT a.id, a.session_id, a.area_id, a.tier_level
  FROM attempts a JOIN lvl_sess s ON s.id = a.session_id
  WHERE a.member_no = p_member_no
),
my_acq AS (
  SELECT DISTINCT ma.area_id, wr.word_master_id
  FROM word_results wr JOIN my_att ma ON ma.id = wr.attempt_id
  WHERE wr.retrieve_passed OR wr.extend_passed
),
area_acq AS (
  SELECT area_id, count(DISTINCT word_master_id) AS acquired FROM my_acq GROUP BY 1
),
acq_all AS (SELECT DISTINCT word_master_id FROM my_acq),
provided AS (
  SELECT DISTINCT word_master_id FROM sess_words
  WHERE session_id IN (SELECT session_id FROM my_att)
),
grades AS (
  SELECT w.grade AS g,
         count(*) AS provided,
         count(*) FILTER (WHERE w.id IN (SELECT word_master_id FROM acq_all)) AS acquired
  FROM provided p JOIN word_master w ON w.id = p.word_master_id
  WHERE w.grade IS NOT NULL
  GROUP BY 1
)
SELECT jsonb_build_object(
  'areas', (
    SELECT jsonb_agg(jsonb_build_object(
             'slug', ar.slug,
             'total', coalesce(t.total, 0),
             'acquired', coalesce(q.acquired, 0),
             'cleared', (SELECT count(DISTINCT m.session_id) FROM my_att m WHERE m.area_id = ar.id AND m.tier_level >= 1)
           ) ORDER BY ar.id)
    FROM areas ar
    LEFT JOIN area_total t ON t.area_id = ar.id
    LEFT JOIN area_acq  q ON q.area_id = ar.id
  ),
  'total_distinct',    (SELECT count(DISTINCT word_master_id) FROM sess_words),
  'acquired_distinct', (SELECT count(*) FROM acq_all),
  'grades', (SELECT coalesce(jsonb_agg(jsonb_build_object('g', g, 'provided', provided, 'acquired', acquired) ORDER BY g), '[]'::jsonb) FROM grades)
);
$$;

REVOKE ALL ON FUNCTION public.wordsense_student_stats(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wordsense_student_stats(bigint, text) TO service_role;
