-- 홈페이지 명예의 전당 — 회차별로 (대표님 2026-10-17, 앱과 같은 규칙)
--   'N회차까지 누적 만점자' = 1회차부터 N회차까지 빠짐없이 만점(is_perfect). 최근 달성(N회차까지 다 채운 시각) 순, 100명
--   기준 회차: p_round (없으면 보는 학생이 그 영역에서 훈련한 마지막 회차, 그것도 없으면 1) — 화면에서 ◀ ▶ 로 넘겨 봄
--   학생마다 지금까지 이어 간 최고 회차(best_round)도 함께 (예: 1~40회 만점)
DROP FUNCTION IF EXISTS public.wordsense_rank_hall_board(text, text, bigint, int, bigint);
CREATE OR REPLACE FUNCTION public.wordsense_rank_hall_board(
  p_area text, p_level text DEFAULT NULL, p_academy_no bigint DEFAULT NULL,
  p_limit int DEFAULT 100, p_member_no bigint DEFAULT NULL, p_round int DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH ar AS (SELECT id, name_ko FROM areas WHERE slug = p_area),
  ss AS (
    SELECT s.id, s.level, s.round_no FROM sessions s JOIN ar ON ar.id = s.area_id
    WHERE p_level IS NULL OR s.level = p_level
  ),
  my AS (   -- 보는 학생이 이 영역에서 훈련한 마지막 회차
    SELECT max(ss.round_no) AS r FROM attempts a JOIN ss ON ss.id = a.session_id
    WHERE p_member_no IS NOT NULL AND a.member_no = p_member_no AND a.finished_at IS NOT NULL
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
           wordsense_mask_name(st.name) AS name, ac.name AS academy
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
                                                          'me', (p_member_no IS NOT NULL AND member_no = p_member_no))
                                       ORDER BY rk)
                      FROM (SELECT * FROM ranked ORDER BY rk LIMIT greatest(1, least(p_limit, 100))) x), '[]'::jsonb),
    'me', (SELECT jsonb_build_object('rank', rk, 'best_round', best_round) FROM ranked
            WHERE p_member_no IS NOT NULL AND member_no = p_member_no ORDER BY rk LIMIT 1)
  );
$$;
REVOKE ALL ON FUNCTION public.wordsense_rank_hall_board(text, text, bigint, int, bigint, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wordsense_rank_hall_board(text, text, bigint, int, bigint, int) TO anon, authenticated;
