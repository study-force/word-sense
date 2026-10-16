-- 랭킹 토글 [전체|초등|중등] × [전체|우리학원] (대표님 2026-10-16)
--   1) wordsense_rank_known (결과 화면 '오늘'·'누적') — p_filter_level(NULL=전체), p_academy_no(NULL=전체) 추가
--      p_use_filter=false(예전 앱)면 예전처럼: 오늘=전체 과정, 누적=p_level 과정
--   2) wordsense_rank_board (홈페이지 랭킹판) — p_period 'all'(전체 기간 누적) 추가
DROP FUNCTION IF EXISTS public.wordsense_rank_known(bigint, text, bigint, uuid, int);
CREATE OR REPLACE FUNCTION public.wordsense_rank_known(
  p_area_id bigint, p_level text, p_member_no bigint, p_exclude_sid uuid, p_round int DEFAULT NULL,
  p_use_filter boolean DEFAULT false, p_filter_level text DEFAULT NULL, p_academy_no bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH k AS (
    SELECT a.member_no, a.area_id, s.level, s.round_no, a.session_init_id, wr.word_master_id, st.academy_no,
           (a.finished_at AT TIME ZONE 'Asia/Seoul')::date AS d
    FROM word_results wr
    JOIN attempts a ON a.id = wr.attempt_id
    JOIN sessions s ON s.id = a.session_id
    LEFT JOIN students st ON st.user_no = a.member_no
    WHERE wr.reinforce_passed AND (wr.retrieve_passed OR wr.recall2_passed)
      AND a.finished_at IS NOT NULL
  ),
  today AS (SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS d),
  -- 과정 필터: 오늘은 (토글 쓰면) 고른 과정 / (예전) 전체, 누적은 (토글 쓰면) 고른 과정 / (예전) p_level
  kt AS (SELECT * FROM k WHERE (NOT p_use_filter OR p_filter_level IS NULL OR k.level = p_filter_level)
                          AND (p_academy_no IS NULL OR k.academy_no = p_academy_no)),
  upto AS (SELECT * FROM k WHERE k.area_id = p_area_id AND (p_round IS NULL OR k.round_no <= p_round)
                            AND (CASE WHEN p_use_filter THEN (p_filter_level IS NULL OR k.level = p_filter_level) ELSE k.level = p_level END)
                            AND (p_academy_no IS NULL OR k.academy_no = p_academy_no)),
  mine AS (SELECT * FROM kt WHERE kt.member_no = p_member_no AND kt.session_init_id IS DISTINCT FROM p_exclude_sid),
  my_days AS (SELECT d, count(DISTINCT (word_master_id, level)) AS n FROM mine GROUP BY d)
  SELECT jsonb_build_object(
    'today', coalesce((SELECT jsonb_agg(jsonb_build_object('member_no', member_no, 'count', n)) FROM (
               SELECT member_no, count(DISTINCT (word_master_id, level)) AS n FROM kt, today t
               WHERE kt.d = t.d AND kt.member_no IS DISTINCT FROM p_member_no GROUP BY member_no) x), '[]'::jsonb),
    'cumul', coalesce((SELECT jsonb_agg(jsonb_build_object('member_no', member_no, 'count', n)) FROM (
               SELECT member_no, count(DISTINCT (word_master_id, level)) AS n FROM upto
               WHERE upto.member_no IS DISTINCT FROM p_member_no GROUP BY member_no) x), '[]'::jsonb),
    'me_today_past', coalesce((SELECT n FROM my_days, today t WHERE my_days.d = t.d), 0),
    'me_best_past',  coalesce((SELECT max(n) FROM my_days, today t WHERE my_days.d < t.d), 0),
    'me_cumul_past', (SELECT count(DISTINCT (word_master_id, level)) FROM upto
                      WHERE upto.member_no = p_member_no AND upto.session_init_id IS DISTINCT FROM p_exclude_sid)
  );
$$;
REVOKE ALL ON FUNCTION public.wordsense_rank_known(bigint, text, bigint, uuid, int, boolean, text, bigint) FROM PUBLIC, anon, authenticated;

-- 홈페이지 랭킹판: 'all' = 전체 기간 누적
CREATE OR REPLACE FUNCTION public.wordsense_rank_board(
  p_period text DEFAULT 'day', p_level text DEFAULT NULL, p_academy_no bigint DEFAULT NULL,
  p_limit int DEFAULT 30, p_member_no bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS today),
  b AS (
    SELECT CASE p_period
             WHEN 'week'  THEN date_trunc('week',  t.today)::date
             WHEN 'month' THEN date_trunc('month', t.today)::date
             WHEN 'all'   THEN DATE '2000-01-01'
             ELSE t.today END AS d0,
           t.today AS d1
    FROM t
  ),
  k AS (
    SELECT DISTINCT a.member_no, wr.word_master_id, s.level
    FROM word_results wr
    JOIN attempts a ON a.id = wr.attempt_id
    JOIN sessions s ON s.id = a.session_id
    LEFT JOIN students st ON st.user_no = a.member_no, b
    WHERE wr.reinforce_passed AND (wr.retrieve_passed OR wr.recall2_passed)
      AND a.finished_at IS NOT NULL
      AND (a.finished_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN b.d0 AND b.d1
      AND (p_level IS NULL OR s.level = p_level)
      AND (p_academy_no IS NULL OR st.academy_no = p_academy_no)
  ),
  agg AS (SELECT k.member_no, count(*) AS n FROM k GROUP BY k.member_no),
  ranked AS (
    SELECT agg.member_no, agg.n, rank() OVER (ORDER BY agg.n DESC) AS rk,
           wordsense_mask_name(st.name) AS name, ac.name AS academy
    FROM agg
    LEFT JOIN students st ON st.user_no = agg.member_no
    LEFT JOIN academies ac ON ac.academy_no = st.academy_no
  )
  SELECT jsonb_build_object(
    'from', (SELECT d0 FROM b), 'to', (SELECT d1 FROM b),
    'total', (SELECT count(*) FROM ranked),
    'academy_name', (SELECT name FROM academies WHERE academy_no = p_academy_no),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('rank', rk, 'name', name, 'academy', academy, 'count', n,
                                                          'me', (p_member_no IS NOT NULL AND member_no = p_member_no))
                                       ORDER BY rk, name)
                      FROM (SELECT * FROM ranked ORDER BY rk, name LIMIT greatest(1, least(p_limit, 100))) x), '[]'::jsonb),
    'me', (SELECT jsonb_build_object('rank', rk, 'count', n) FROM ranked WHERE p_member_no IS NOT NULL AND member_no = p_member_no)
  );
$$;
