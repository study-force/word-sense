-- 랭킹을 '내 어휘' 기준 2종으로 (대표님 2026-10-17)
--   오늘: 오늘(KST) 새로 '내 어휘'가 된 수 — 재훈련 포함 (재훈련은 이미 아는 어휘가 빠지므로 새로 익힌 것만 더해짐)
--   누적: 이 영역·이 과정(초등/중등)에서 지금까지 모은 '내 어휘' 수 — 같은 어휘는 한 번만
--   '내 어휘' = 강화 첫 시도 정답 AND (1 인출 OR 3 다시 인출) — wordsense_known_words와 같은 기준
-- 호출: Edge Function wordsense-rank (service_role) 만. anon/authenticated 실행 권한 없음.
CREATE OR REPLACE FUNCTION public.wordsense_rank_known(
  p_area_id bigint, p_level text, p_member_no bigint, p_exclude_sid uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH k AS (
    SELECT a.member_no, a.area_id, s.level, a.session_init_id, wr.word_master_id,
           (a.finished_at AT TIME ZONE 'Asia/Seoul')::date AS d
    FROM word_results wr
    JOIN attempts a ON a.id = wr.attempt_id
    JOIN sessions s ON s.id = a.session_id
    WHERE wr.reinforce_passed AND (wr.retrieve_passed OR wr.recall2_passed)
      AND a.finished_at IS NOT NULL
  ),
  today AS (SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS d),
  mine AS (SELECT * FROM k WHERE k.member_no = p_member_no AND k.session_init_id IS DISTINCT FROM p_exclude_sid),
  my_days AS (SELECT d, count(DISTINCT (word_master_id, level)) AS n FROM mine GROUP BY d)
  SELECT jsonb_build_object(
    'today', coalesce((SELECT jsonb_agg(jsonb_build_object('member_no', member_no, 'count', n)) FROM (
               SELECT member_no, count(DISTINCT (word_master_id, level)) AS n FROM k, today t
               WHERE k.d = t.d AND k.member_no IS DISTINCT FROM p_member_no GROUP BY member_no) x), '[]'::jsonb),
    'cumul', coalesce((SELECT jsonb_agg(jsonb_build_object('member_no', member_no, 'count', n)) FROM (
               SELECT member_no, count(DISTINCT word_master_id) AS n FROM k
               WHERE k.area_id = p_area_id AND k.level = p_level AND k.member_no IS DISTINCT FROM p_member_no GROUP BY member_no) x), '[]'::jsonb),
    'me_today_past', coalesce((SELECT n FROM my_days, today t WHERE my_days.d = t.d), 0),
    'me_best_past',  coalesce((SELECT max(n) FROM my_days, today t WHERE my_days.d < t.d), 0),
    'me_cumul_past', (SELECT count(DISTINCT word_master_id) FROM mine WHERE area_id = p_area_id AND level = p_level)
  );
$$;
REVOKE ALL ON FUNCTION public.wordsense_rank_known(bigint, text, bigint, uuid) FROM PUBLIC, anon, authenticated;
