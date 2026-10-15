-- ════════════════════════════════════════════════════════════════
-- 4단계 훈련 + 누적 '내 어휘' (대표님 결정 2026-10-15)
--   흐름: 1 인출 → 2 학습(확장) → 3 다시 인출 → 4 강화(인출에서 떠올린 어휘만)
--   내 어휘 = 같은 훈련에서 (1 인출 또는 3 다시 인출) + 강화 첫 시도 정답
--     · 다음 훈련(재훈련 포함)부터 금색 칩으로 켜진 채 시작, 다시 출제하지 않음
--     · 과정(초등/중등)별로 따로 쌓임
--   통과·퍼펙트·통계 습득도 '내 어휘' 기준
-- 적용 순서: 테스트 DB → 검증 → 운영 DB
-- ════════════════════════════════════════════════════════════════

ALTER TABLE word_results ADD COLUMN IF NOT EXISTS recall2_passed BOOLEAN NOT NULL DEFAULT false;   -- 3 다시 인출에서 떠올림
ALTER TABLE attempts     ADD COLUMN IF NOT EXISTS is_perfect     BOOLEAN NOT NULL DEFAULT false;   -- 이 훈련 후 회차 어휘 전부가 내 어휘
ALTER TABLE attempts     ADD COLUMN IF NOT EXISTS known_count    INT;                               -- 이 훈련 후 회차의 내 어휘 수(누적)

-- 학생의 과정별 '내 어휘' 목록 (word_master_id 배열) — wordsense-session이 service_role로 호출
CREATE OR REPLACE FUNCTION public.wordsense_known_words(p_member_no bigint, p_level text)
RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(array_agg(DISTINCT wr.word_master_id), '{}')
  FROM word_results wr
  JOIN attempts a ON a.id = wr.attempt_id
  JOIN sessions s ON s.id = a.session_id
  WHERE a.member_no = p_member_no
    AND s.level = p_level
    AND wr.reinforce_passed
    AND (wr.retrieve_passed OR wr.recall2_passed);
$$;
REVOKE ALL ON FUNCTION public.wordsense_known_words(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wordsense_known_words(bigint, text) TO service_role;

-- 통계 습득 기준 = 내 어휘 (인출/다시 인출 + 강화 통과)
CREATE OR REPLACE FUNCTION public.wordsense_student_stats(p_member_no bigint, p_level text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  WHERE wr.reinforce_passed AND (wr.retrieve_passed OR wr.recall2_passed)   -- 내 어휘(4단계, 2026-10-15)
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
$function$;
