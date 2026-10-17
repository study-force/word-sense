-- 랭킹판: '나'만 전체 이름, 다른 친구는 가운데 별표 (대표님 2026-10-18)
--   '나'는 입장권(p_ticket = session_init.id, 하루 이내)으로 서버가 확인 — 주소의 회원번호(me)만으로는 전체 이름을 주지 않음
--   (회원번호만 바꿔 넣어 남의 실명을 보는 것 방지). p_member_no는 강조 표시·내 회차용으로 그대로
DROP FUNCTION IF EXISTS public.wordsense_rank_board(text, text, bigint, int, bigint);
CREATE OR REPLACE FUNCTION public.wordsense_rank_board(
  p_period text DEFAULT 'day', p_level text DEFAULT NULL, p_academy_no bigint DEFAULT NULL,
  p_limit int DEFAULT 30, p_member_no bigint DEFAULT NULL, p_ticket uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH tk AS (   -- 입장권으로 확인된 '나' (전체 이름은 나에게만)
    SELECT user_no FROM session_init WHERE p_ticket IS NOT NULL AND id = p_ticket AND coalesce(used_at, created_at) > now() - interval '1 day'
  ),
  t AS (SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS today),
  b AS (
    SELECT CASE p_period
             WHEN 'week'  THEN date_trunc('week',  t.today)::date
             WHEN 'month' THEN date_trunc('month', t.today)::date
             ELSE t.today END AS d0,
           t.today AS d1
    FROM t
  ),
  k0 AS (
    SELECT a.member_no, wr.word_master_id, s.level, s.area_id
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
  k AS (SELECT DISTINCT member_no, word_master_id, level FROM k0),
  agg AS (
    SELECT k.member_no, count(*) AS n FROM k GROUP BY k.member_no
  ),
  per_area AS (   -- 학생별 영역 내역 (예: 생물 9 · 역사 3)
    SELECT x.member_no, jsonb_agg(jsonb_build_object('area', ar.name_ko, 'n', x.n) ORDER BY x.n DESC, ar.display_order) AS areas
    FROM (SELECT member_no, area_id, count(DISTINCT (word_master_id, level)) AS n FROM k0 GROUP BY 1, 2) x
    JOIN areas ar ON ar.id = x.area_id
    GROUP BY x.member_no
  ),
  ranked AS (
    SELECT agg.member_no, agg.n, rank() OVER (ORDER BY agg.n DESC) AS rk,
           CASE WHEN agg.member_no = (SELECT user_no FROM tk) THEN st.name ELSE wordsense_mask_name(st.name) END AS name, ac.name AS academy, pa.areas
    FROM agg
    LEFT JOIN students st ON st.user_no = agg.member_no
    LEFT JOIN academies ac ON ac.academy_no = st.academy_no
    LEFT JOIN per_area pa ON pa.member_no = agg.member_no
  )
  SELECT jsonb_build_object(
    'from', (SELECT d0 FROM b), 'to', (SELECT d1 FROM b),
    'total', (SELECT count(*) FROM ranked),
    'academy_name', (SELECT name FROM academies WHERE academy_no = p_academy_no),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('rank', rk, 'name', name, 'academy', academy, 'count', n, 'areas', areas,
                                                          'me', (member_no = p_member_no OR member_no = (SELECT user_no FROM tk)))
                                       ORDER BY rk, name)
                      FROM (SELECT * FROM ranked ORDER BY rk, name LIMIT greatest(1, least(p_limit, 100))) x), '[]'::jsonb),
    'me', (SELECT jsonb_build_object('rank', rk, 'count', n) FROM ranked WHERE member_no = coalesce((SELECT user_no FROM tk), p_member_no))
  );
$$;
REVOKE ALL ON FUNCTION public.wordsense_rank_board(text, text, bigint, int, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wordsense_rank_board(text, text, bigint, int, bigint, uuid) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.wordsense_rank_hall_board(text, text, bigint, int, bigint, int);
CREATE OR REPLACE FUNCTION public.wordsense_rank_hall_board(
  p_area text, p_level text DEFAULT NULL, p_academy_no bigint DEFAULT NULL,
  p_limit int DEFAULT 100, p_member_no bigint DEFAULT NULL, p_round int DEFAULT NULL, p_ticket uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH tk AS (   -- 입장권으로 확인된 '나' (전체 이름은 나에게만)
    SELECT user_no FROM session_init WHERE p_ticket IS NOT NULL AND id = p_ticket AND coalesce(used_at, created_at) > now() - interval '1 day'
  ),
  me AS (SELECT coalesce((SELECT user_no FROM tk), p_member_no) AS m),
  ar AS (SELECT id, name_ko FROM areas WHERE slug = p_area),
  ss AS (
    SELECT s.id, s.level, s.round_no FROM sessions s JOIN ar ON ar.id = s.area_id
    WHERE p_level IS NULL OR s.level = p_level
  ),
  my AS (   -- 보는 학생이 이 영역에서 훈련한 마지막 회차
    SELECT max(ss.round_no) AS r FROM attempts a JOIN ss ON ss.id = a.session_id
    WHERE a.member_no = (SELECT m FROM me) AND a.finished_at IS NOT NULL
  ),
  rnd AS (
    SELECT greatest(1, least(coalesce(p_round, (SELECT r FROM my), 1), coalesce((SELECT max(round_no) FROM ss), 1))) AS n
  ),
  pf AS (   -- 회차별 첫 만점 시각
    SELECT a.member_no, ss.level, ss.round_no, min(a.finished_at) AS at
    FROM attempts a JOIN ss ON ss.id = a.session_id
    WHERE a.is_perfect AND a.finished_at IS NOT NULL
    GROUP BY 1, 2, 3
  ),
  chain AS (   -- 1회차부터 빠짐없이 이어진 만점만 (회차 = 차례 번호)
    SELECT pf.*, round_no - row_number() OVER (PARTITION BY member_no, level ORDER BY round_no) AS gap
    FROM pf
  ),
  best AS (
    SELECT c.member_no, c.level, max(c.round_no) AS best_round,
           max(c.at) FILTER (WHERE c.round_no <= (SELECT n FROM rnd)) AS at   -- N회차까지 다 채운 시각
    FROM chain c WHERE c.gap = 0
    GROUP BY 1, 2
    HAVING max(c.round_no) >= (SELECT n FROM rnd)
  ),
  ranked AS (
    SELECT b.*, row_number() OVER (ORDER BY b.at DESC, b.member_no) AS rk,
           CASE WHEN b.member_no = (SELECT user_no FROM tk) THEN st.name ELSE wordsense_mask_name(st.name) END AS name, ac.name AS academy
    FROM best b
    LEFT JOIN students st ON st.user_no = b.member_no
    LEFT JOIN academies ac ON ac.academy_no = st.academy_no
    WHERE p_academy_no IS NULL OR st.academy_no = p_academy_no
  )
  SELECT jsonb_build_object(
    'area', (SELECT name_ko FROM ar),
    'round', (SELECT n FROM rnd),
    'max_round', (SELECT max(round_no) FROM ss),
    'my_round', (SELECT r FROM my),
    'total', (SELECT count(*) FROM ranked),
    'academy_name', (SELECT name FROM academies WHERE academy_no = p_academy_no),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('rank', rk, 'name', name, 'academy', academy, 'level', level,
                                                          'best_round', best_round, 'at', (at AT TIME ZONE 'Asia/Seoul')::date,
                                                          'me', (member_no = (SELECT m FROM me)))
                                       ORDER BY rk)
                      FROM (SELECT * FROM ranked ORDER BY rk LIMIT greatest(1, least(p_limit, 100))) x), '[]'::jsonb),
    'me', (SELECT jsonb_build_object('rank', rk, 'best_round', best_round) FROM ranked
            WHERE member_no = (SELECT m FROM me) ORDER BY rk LIMIT 1)
  );
$$;
REVOKE ALL ON FUNCTION public.wordsense_rank_hall_board(text, text, bigint, int, bigint, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wordsense_rank_hall_board(text, text, bigint, int, bigint, int, uuid) TO anon, authenticated;
