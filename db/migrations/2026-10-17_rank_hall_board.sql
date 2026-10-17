-- 홈페이지 랭킹판 개편 (대표님 2026-10-17)
--   ① 오늘의 랭킹: 하나로 합침 + 학생마다 어느 영역에서 익혔는지(areas) 함께
--   ② 명예의 전당(누적 랭킹 대신): 영역별. 1회차부터 빠짐없이 만점(is_perfect)으로 이어진 회차까지의
--      누적 어휘 수가 많은 순, 같으면 최근 달성 순. 영역마다 100명까지
--   이름은 서버에서 가려서 내보냄(홍*동)

-- ① 오늘의 랭킹 — 기존 함수에 areas만 더함 (점수 계산은 그대로)
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
           wordsense_mask_name(st.name) AS name, ac.name AS academy, pa.areas
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
                                                          'me', (p_member_no IS NOT NULL AND member_no = p_member_no))
                                       ORDER BY rk, name)
                      FROM (SELECT * FROM ranked ORDER BY rk, name LIMIT greatest(1, least(p_limit, 100))) x), '[]'::jsonb),
    'me', (SELECT jsonb_build_object('rank', rk, 'count', n) FROM ranked WHERE p_member_no IS NOT NULL AND member_no = p_member_no)
  );
$$;
REVOKE ALL ON FUNCTION public.wordsense_rank_board(text, text, bigint, int, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wordsense_rank_board(text, text, bigint, int, bigint) TO anon, authenticated;

-- ② 명예의 전당 (영역별)
CREATE OR REPLACE FUNCTION public.wordsense_rank_hall_board(
  p_area text, p_level text DEFAULT NULL, p_academy_no bigint DEFAULT NULL,
  p_limit int DEFAULT 100, p_member_no bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH ar AS (SELECT id, name_ko FROM areas WHERE slug = p_area),
  ss AS (
    SELECT s.id, s.level, s.round_no FROM sessions s JOIN ar ON ar.id = s.area_id
    WHERE p_level IS NULL OR s.level = p_level
  ),
  pf AS (   -- 회차별 첫 만점 시각·그때 어휘 수
    SELECT a.member_no, ss.level, ss.round_no, min(a.finished_at) AS at, max(a.total_words) AS tw
    FROM attempts a JOIN ss ON ss.id = a.session_id
    WHERE a.is_perfect AND a.finished_at IS NOT NULL
    GROUP BY 1, 2, 3
  ),
  chain AS (   -- 1회차부터 빠짐없이 이어진 만점만 (회차 = 차례 번호)
    SELECT pf.*, round_no - row_number() OVER (PARTITION BY member_no, level ORDER BY round_no) AS gap
    FROM pf
  ),
  best AS (
    SELECT member_no, level, max(round_no) AS k, sum(coalesce(tw, 0)) AS n, max(at) AS at
    FROM chain WHERE gap = 0
    GROUP BY 1, 2
  ),
  ranked AS (
    SELECT b.*, rank() OVER (ORDER BY b.n DESC) AS rk,
           row_number() OVER (ORDER BY b.n DESC, b.at DESC) AS ord,
           wordsense_mask_name(st.name) AS name, ac.name AS academy
    FROM best b
    LEFT JOIN students st ON st.user_no = b.member_no
    LEFT JOIN academies ac ON ac.academy_no = st.academy_no
    WHERE p_academy_no IS NULL OR st.academy_no = p_academy_no
  )
  SELECT jsonb_build_object(
    'area', (SELECT name_ko FROM ar),
    'total', (SELECT count(*) FROM ranked),
    'academy_name', (SELECT name FROM academies WHERE academy_no = p_academy_no),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('rank', rk, 'name', name, 'academy', academy, 'level', level,
                                                          'rounds', k, 'count', n, 'at', (at AT TIME ZONE 'Asia/Seoul')::date,
                                                          'me', (p_member_no IS NOT NULL AND member_no = p_member_no))
                                       ORDER BY ord)
                      FROM (SELECT * FROM ranked ORDER BY ord LIMIT greatest(1, least(p_limit, 100))) x), '[]'::jsonb),
    'me', (SELECT jsonb_build_object('rank', rk, 'count', n, 'rounds', k) FROM ranked
            WHERE p_member_no IS NOT NULL AND member_no = p_member_no ORDER BY ord LIMIT 1)
  );
$$;
REVOKE ALL ON FUNCTION public.wordsense_rank_hall_board(text, text, bigint, int, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wordsense_rank_hall_board(text, text, bigint, int, bigint) TO anon, authenticated;
