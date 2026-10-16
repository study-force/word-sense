-- 누적 랭킹은 '이 영역에서 지금 회차까지'만 (대표님 2026-10-17)
--   뒤 회차까지 한 학생이 그 회차들의 어휘로 앞서지 않게 → 앞 회차 학생도 공평하게 순위에
--   p_round: 지금 훈련한 회차 번호(sessions.round_no). NULL이면 영역 전체(예전 방식)
DROP FUNCTION IF EXISTS public.wordsense_rank_known(bigint, text, bigint, uuid);
CREATE OR REPLACE FUNCTION public.wordsense_rank_known(
  p_area_id bigint, p_level text, p_member_no bigint, p_exclude_sid uuid, p_round int DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH k AS (
    SELECT a.member_no, a.area_id, s.level, s.round_no, a.session_init_id, wr.word_master_id,
           (a.finished_at AT TIME ZONE 'Asia/Seoul')::date AS d
    FROM word_results wr
    JOIN attempts a ON a.id = wr.attempt_id
    JOIN sessions s ON s.id = a.session_id
    WHERE wr.reinforce_passed AND (wr.retrieve_passed OR wr.recall2_passed)
      AND a.finished_at IS NOT NULL
  ),
  today AS (SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS d),
  upto AS (SELECT * FROM k WHERE k.area_id = p_area_id AND k.level = p_level AND (p_round IS NULL OR k.round_no <= p_round)),
  mine AS (SELECT * FROM k WHERE k.member_no = p_member_no AND k.session_init_id IS DISTINCT FROM p_exclude_sid),
  my_days AS (SELECT d, count(DISTINCT (word_master_id, level)) AS n FROM mine GROUP BY d)
  SELECT jsonb_build_object(
    'today', coalesce((SELECT jsonb_agg(jsonb_build_object('member_no', member_no, 'count', n)) FROM (
               SELECT member_no, count(DISTINCT (word_master_id, level)) AS n FROM k, today t
               WHERE k.d = t.d AND k.member_no IS DISTINCT FROM p_member_no GROUP BY member_no) x), '[]'::jsonb),
    'cumul', coalesce((SELECT jsonb_agg(jsonb_build_object('member_no', member_no, 'count', n)) FROM (
               SELECT member_no, count(DISTINCT word_master_id) AS n FROM upto
               WHERE upto.member_no IS DISTINCT FROM p_member_no GROUP BY member_no) x), '[]'::jsonb),
    'me_today_past', coalesce((SELECT n FROM my_days, today t WHERE my_days.d = t.d), 0),
    'me_best_past',  coalesce((SELECT max(n) FROM my_days, today t WHERE my_days.d < t.d), 0),
    'me_cumul_past', (SELECT count(DISTINCT word_master_id) FROM upto
                      WHERE upto.member_no = p_member_no AND upto.session_init_id IS DISTINCT FROM p_exclude_sid)
  );
$$;
REVOKE ALL ON FUNCTION public.wordsense_rank_known(bigint, text, bigint, uuid, int) FROM PUBLIC, anon, authenticated;
