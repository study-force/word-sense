-- ════════════════════════════════════════════════════════════════
-- '내 어휘'를 主字별로 따로 (대표님 2026-11-06)
--   문제: 面(낯 면) 회차에서 익힌 '외면'이 外(바깥 외) 회차에서도 이미 내 어휘(금색 칩)로 나옴 → 처음인데 '재도전'·'획득 1'
--   기준: 主字가 다르면 같은 어휘라도 그 主字의 가족 어휘로는 처음 → 학습 어휘로 출제
--   바뀌는 곳: 훈련 시작 때 금색 칩(wordsense-session), 훈사전·마이룸 회차 현황·단원평가 자격(area_progress),
--             학생 통계 통과 회차(student_stats)
--   그대로: 영역별·전체 '획득 어휘 수'(같은 어휘는 한 번), 랭킹
-- 적용 순서: 테스트 DB → 검증 → 운영 DB → Edge Function wordsense-session 재배포
-- ════════════════════════════════════════════════════════════════

-- 학생의 과정별 '내 어휘'를 (主字, 어휘) 쌍으로 — 어느 主字 회차에서 익혔는지까지
CREATE OR REPLACE FUNCTION public.wordsense_known_pairs(p_member_no bigint, p_level text)
RETURNS TABLE(main_char text, wm bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT DISTINCT s.main_char, wr.word_master_id::bigint
  FROM word_results wr
  JOIN attempts a ON a.id = wr.attempt_id
  JOIN sessions s ON s.id = a.session_id
  WHERE a.member_no = p_member_no
    AND s.level = p_level
    AND wr.reinforce_passed
    AND (wr.retrieve_passed OR wr.recall2_passed);
$$;
REVOKE ALL ON FUNCTION public.wordsense_known_pairs(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wordsense_known_pairs(bigint, text) TO service_role;

-- 이 主字 회차의 '내 어휘' 목록 — wordsense-session이 훈련 시작 때 호출 (금색 칩·출제 제외)
CREATE OR REPLACE FUNCTION public.wordsense_known_words_char(p_member_no bigint, p_level text, p_main_char text)
RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(array_agg(wm), '{}') FROM wordsense_known_pairs(p_member_no, p_level) WHERE main_char = p_main_char;
$$;
REVOKE ALL ON FUNCTION public.wordsense_known_words_char(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wordsense_known_words_char(bigint, text, text) TO service_role;

-- 훈사전·마이룸·단원평가 자격: 회차별 known = 그 회차 主字에서 익힌 어휘만
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
known AS (SELECT main_char, wm FROM wordsense_known_pairs(p_member_no, p_level)),   -- 主字별 내 어휘 (2026-11-06)
att AS (SELECT DISTINCT session_id FROM attempts WHERE member_no = p_member_no)
SELECT coalesce(jsonb_agg(jsonb_build_object(
         'round',   s.round_no,
         'total',   (SELECT count(DISTINCT x.word_master_id) FROM sw x WHERE x.session_id = s.id),
         'known',   (SELECT count(DISTINCT x.word_master_id) FROM sw x JOIN known k ON k.wm = x.word_master_id AND k.main_char = s.main_char WHERE x.session_id = s.id),
         'trained', s.id IN (SELECT session_id FROM att)
       ) ORDER BY s.round_no), '[]'::jsonb)
FROM lvl_sess s;
$$;

-- 학생 통계: 통과 회차도 그 회차 主字에서 익힌 어휘 기준 (획득 어휘 수는 그대로 — 같은 어휘는 한 번)
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
known_pairs AS (SELECT main_char, wm FROM wordsense_known_pairs(p_member_no, p_level)),   -- 主字별 내 어휘 (2026-11-06)
pass_round AS (   -- 통과 회차 = 훈련한 회차 중 어휘의 80% 이상이 내 어휘 (훈사전·단원평가와 같은 기준, 2026-10-17)
  SELECT sw.session_id, sw.area_id
  FROM sess_words sw JOIN lvl_sess ls ON ls.id = sw.session_id
  WHERE sw.session_id IN (SELECT session_id FROM my_att)
  GROUP BY sw.session_id, sw.area_id
  HAVING count(DISTINCT sw.word_master_id) > 0
     AND count(DISTINCT sw.word_master_id) FILTER (WHERE EXISTS (
           SELECT 1 FROM known_pairs k WHERE k.wm = sw.word_master_id AND k.main_char = ls.main_char)) * 10
         >= count(DISTINCT sw.word_master_id) * 8
),
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
             'cleared', (SELECT count(*) FROM pass_round pr WHERE pr.area_id = ar.id)
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
