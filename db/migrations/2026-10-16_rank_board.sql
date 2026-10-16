-- 홈페이지 공통 랭킹판 (대표님 2026-10-16)
--   기간: day(오늘) / week(이번 주, 월~일) / month(이번 달) — KST
--   과정: NULL=통합 / '초등' / '중등'
--   범위: p_academy_no NULL=전국 / 값=우리학원
--   점수 = 그 기간에 새로 '내 어휘'가 된 수 (강화 첫 시도 정답 AND (1 인출 OR 3 다시 인출)), 여러 회차·재훈련 모두 합산
--   이름은 서버에서 가려서 내보냄(홍*동) — 공개 화면이라 실명 전체·회원번호는 내보내지 않음
--   p_member_no: 앱에서 열었을 때 '나'의 순위 표시용(선택)
CREATE OR REPLACE FUNCTION public.wordsense_mask_name(n text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN n IS NULL OR btrim(n) = '' THEN '회원'
    WHEN char_length(btrim(n)) = 1 THEN btrim(n)
    WHEN char_length(btrim(n)) = 2 THEN left(btrim(n), 1) || '*'
    ELSE left(btrim(n), 1) || repeat('*', char_length(btrim(n)) - 2) || right(btrim(n), 1)
  END
$$;

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
  agg AS (
    SELECT k.member_no, count(*) AS n FROM k GROUP BY k.member_no
  ),
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
REVOKE ALL ON FUNCTION public.wordsense_rank_board(text, text, bigint, int, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wordsense_rank_board(text, text, bigint, int, bigint) TO anon, authenticated;
