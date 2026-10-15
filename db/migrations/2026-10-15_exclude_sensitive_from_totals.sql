-- 서버 집계(통계·훈사전)에서 민감 어휘 제외 — 앱 학습 목록과 숫자 일치 (대표님 확인 2026-10-15)

CREATE OR REPLACE FUNCTION public.wordsense_student_stats(p_member_no bigint, p_level text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH lvl_sess AS (
  SELECT id, area_id, main_char FROM sessions WHERE level = p_level
),
sess_words_all AS (            -- 회차별 실제 출제 어휘
  SELECT s.id AS session_id, s.area_id, sw.word_master_id
  FROM lvl_sess s JOIN session_words sw ON sw.session_id = s.id
  UNION
  SELECT s.id, s.area_id, sw.word_master_id      -- 중등: 主字가 들어간 초등 어휘 전부 (2026-10-15 확장)
  FROM lvl_sess s
  JOIN word_master w ON p_level = '중등' AND position(s.main_char in w.hanja) > 0
  JOIN session_words sw ON sw.word_master_id = w.id
  JOIN sessions e ON e.id = sw.session_id AND e.level = '초등'
),
sess_words AS (   -- 민감 어휘(비하어·신체·성)는 학습 어휘에서 제외 — 앱 WORD_LIST와 같은 기준 (2026-10-15)
  SELECT a.* FROM sess_words_all a JOIN word_master wm ON wm.id = a.word_master_id WHERE wm.sensitive IS NULL
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

CREATE OR REPLACE FUNCTION public.wordsense_area_progress(p_member_no bigint, p_area_id bigint, p_level text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
WITH lvl_sess AS (
  SELECT id, round_no, main_char FROM sessions WHERE level = p_level AND area_id = p_area_id
),
sw_all AS (
  SELECT s.id AS session_id, sw.word_master_id
  FROM lvl_sess s JOIN session_words sw ON sw.session_id = s.id
  UNION
  SELECT s.id, sw.word_master_id
  FROM lvl_sess s
  JOIN word_master w ON p_level = '중등' AND position(s.main_char in w.hanja) > 0
  JOIN session_words sw ON sw.word_master_id = w.id
  JOIN sessions e ON e.id = sw.session_id AND e.level = '초등'
),
sw AS (   -- 민감 어휘(비하어·신체·성)는 학습 어휘에서 제외 — 앱 WORD_LIST와 같은 기준 (2026-10-15)
  SELECT a.* FROM sw_all a JOIN word_master wm ON wm.id = a.word_master_id WHERE wm.sensitive IS NULL
),
known AS (SELECT unnest(wordsense_known_words(p_member_no, p_level)) AS wm),
att AS (SELECT DISTINCT session_id FROM attempts WHERE member_no = p_member_no)
SELECT coalesce(jsonb_agg(jsonb_build_object(
         'round',   s.round_no,
         'total',   (SELECT count(DISTINCT x.word_master_id) FROM sw x WHERE x.session_id = s.id),
         'known',   (SELECT count(DISTINCT x.word_master_id) FROM sw x JOIN known k ON k.wm = x.word_master_id WHERE x.session_id = s.id),
         'trained', s.id IN (SELECT session_id FROM att)
       ) ORDER BY s.round_no), '[]'::jsonb)
FROM lvl_sess s;
$$;
