-- 오늘의 랭킹: 영역별 내역 + 합산 (대표님 2026-10-16) — 오늘 점수 = 영역별 새 내 어휘 수의 합
CREATE OR REPLACE FUNCTION public.wordsense_rank_known(
  p_area_id bigint, p_level text, p_member_no bigint, p_exclude_sid uuid, p_round int DEFAULT NULL,
  p_use_filter boolean DEFAULT false, p_filter_level text DEFAULT NULL, p_academy_no bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH k AS (
    SELECT a.member_no, a.area_id, ar.name_ko AS area_name, s.level, s.round_no, a.session_init_id, wr.word_master_id, st.academy_no,
           (a.finished_at AT TIME ZONE 'Asia/Seoul')::date AS d
    FROM word_results wr
    JOIN attempts a ON a.id = wr.attempt_id
    JOIN sessions s ON s.id = a.session_id
    JOIN areas ar ON ar.id = a.area_id
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
  my_days AS (SELECT d, count(DISTINCT (word_master_id, level)) AS n FROM mine GROUP BY d),
  -- 오늘 영역별 내역 (합산 = 영역별 합) — 대표님 2026-10-16: 순위 표에 어느 영역에서 획득했는지
  t_area AS (SELECT kt.member_no, kt.area_name, count(DISTINCT (word_master_id, level)) AS n FROM kt, today t
             WHERE kt.d = t.d GROUP BY kt.member_no, kt.area_name)
  SELECT jsonb_build_object(
    'today', coalesce((SELECT jsonb_agg(jsonb_build_object('member_no', member_no, 'count', n, 'areas', areas)) FROM (
               SELECT member_no, sum(n)::int AS n, jsonb_agg(jsonb_build_object('area', area_name, 'count', n) ORDER BY n DESC) AS areas
               FROM t_area WHERE t_area.member_no IS DISTINCT FROM p_member_no GROUP BY member_no) x), '[]'::jsonb),
    'me_today_areas', coalesce((SELECT jsonb_agg(jsonb_build_object('area', area_name, 'count', n) ORDER BY n DESC) FROM (
               SELECT kt.area_name, count(DISTINCT (word_master_id, level)) AS n FROM kt, today t
               WHERE kt.d = t.d AND kt.member_no = p_member_no AND kt.session_init_id IS DISTINCT FROM p_exclude_sid
               GROUP BY kt.area_name) y), '[]'::jsonb),
    'cumul', coalesce((SELECT jsonb_agg(jsonb_build_object('member_no', member_no, 'count', n)) FROM (
               SELECT member_no, count(DISTINCT (word_master_id, level)) AS n FROM upto
               WHERE upto.member_no IS DISTINCT FROM p_member_no GROUP BY member_no) x), '[]'::jsonb),
    'me_today_past', coalesce((SELECT sum(n)::int FROM (SELECT kt.area_name, count(DISTINCT (word_master_id, level)) AS n FROM kt, today t WHERE kt.d = t.d AND kt.member_no = p_member_no AND kt.session_init_id IS DISTINCT FROM p_exclude_sid GROUP BY kt.area_name) z), 0),
    'me_best_past',  coalesce((SELECT max(n) FROM my_days, today t WHERE my_days.d < t.d), 0),
    'me_cumul_past', (SELECT count(DISTINCT (word_master_id, level)) FROM upto
                      WHERE upto.member_no = p_member_no AND upto.session_init_id IS DISTINCT FROM p_exclude_sid)
  );
$$;
REVOKE ALL ON FUNCTION public.wordsense_rank_known(bigint, text, bigint, uuid, int, boolean, text, bigint) FROM PUBLIC, anon, authenticated;

