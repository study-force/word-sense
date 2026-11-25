-- ════════════════════════════════════════════════════════════════
-- 마이룸 회차별 현황 — 여러 학생을 한 번에 + 툴팁 숫자 (성효민 대리 요청 2026-11-25)
--   쓰는 곳: Edge Function wordsense-progress 의 action:"rounds"
--   전에는 학생 한 명마다 wordsense_area_progress 를 따로 불렀음(학생 50명 = 50번 × 조회 7개).
--   이 함수는 학생 여러 명(학생·과정·영역 묶음)을 한 번의 조회로 계산해 돌려줌.
--
--   입력  p_targets = [{ "m": 회원번호, "level": "초등"|"중등", "area_id": 영역번호 }, …]
--   출력  [{ m, level, area_id, rounds:[…], units:[…] }, …]
--     rounds = 훈련한 회차 + 하다 만 회차 (wordsense_area_progress 와 같은 계산: total·known·trained)
--              + 재도전 횟수, 학원 완료 여부, 복습 횟수, 이어하기 자리, 첫 훈련의 인출·확장·강화 숫자와 시작·종료 시각
--     units  = 5회차 묶음(실력 점검) — 통과 회차 수, 응시 가능 여부, 응시 횟수, 점수(완전 습득·추론·총점), 문항 수
--
--   새 표·새 칸은 없음(읽기만 하는 함수 1개 + 색인 1개). 학생 기록을 바꾸지 않음.
--   획득 기준은 wordsense_area_progress(2026-11-06)와 같음: 그 회차 主字에서 (인출 또는 다시 인출) + 강화 통과.
--   → 이 함수를 고칠 때는 wordsense_area_progress 와 숫자가 같은지 꼭 비교할 것.
-- 적용 순서: 테스트 DB → 숫자 비교 → 운영 DB → Edge Function wordsense-progress 배포
--   (Edge Function 은 이 함수가 없으면 예전 방식으로 답하므로, 순서가 바뀌어도 기존 화면은 멈추지 않음)
-- 되돌리기: 2026-11-25_rounds_batch_ROLLBACK.sql
-- ════════════════════════════════════════════════════════════════

-- 입장권 표를 회원번호로 찾는 색인 — 지금은 없어서 '학원 완료 여부'를 볼 때마다 표 전체를 읽음(학생이 늘수록 느려짐)
CREATE INDEX IF NOT EXISTS idx_session_init_user_no ON public.session_init (user_no);

CREATE OR REPLACE FUNCTION public.wordsense_rounds_batch(p_targets jsonb)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
WITH tg AS (   -- 조회할 묶음 (학생·과정·영역) — 같은 묶음은 한 번만, 안전하게 200개까지
  SELECT DISTINCT (x->>'m')::bigint AS m, x->>'level' AS level, (x->>'area_id')::bigint AS area_id
  FROM jsonb_array_elements(coalesce(p_targets, '[]'::jsonb)) x
  WHERE (x->>'m') ~ '^[0-9]{1,15}$' AND (x->>'area_id') ~ '^[0-9]{1,9}$' AND x->>'level' IN ('초등', '중등')
  LIMIT 200
),
la AS (SELECT DISTINCT t.level, t.area_id, ar.slug FROM tg t JOIN areas ar ON ar.id = t.area_id),
sess AS (   -- 그 과정·영역의 회차들
  SELECT s.id, s.level, s.area_id, s.round_no, s.main_char, la.slug
  FROM sessions s JOIN la ON la.level = s.level AND la.area_id = s.area_id
),
sw_all AS (   -- 회차 어휘 (중등은 같은 主字의 초등 어휘 포함) — wordsense_area_progress 와 같음
  SELECT s.id AS session_id, sw.word_master_id
  FROM sess s JOIN session_words sw ON sw.session_id = s.id
  UNION
  SELECT s.id, sw.word_master_id
  FROM sess s
  JOIN word_master w ON s.level = '중등' AND position(s.main_char in w.hanja) > 0
  JOIN session_words sw ON sw.word_master_id = w.id
  JOIN sessions e ON e.id = sw.session_id AND e.level = '초등'
),
sw AS (   -- 민감 어휘 제외 (2026-10-15)
  SELECT a.* FROM sw_all a JOIN word_master wm ON wm.id = a.word_master_id WHERE wm.sensitive IS NULL
),
tot AS (SELECT session_id, count(DISTINCT word_master_id) AS total FROM sw GROUP BY 1),
mem AS (SELECT DISTINCT m, level FROM tg),
known AS (   -- 主字별 내 어휘 — wordsense_known_pairs 와 같음 (학생 여러 명을 한 번에)
  SELECT DISTINCT a.member_no AS m, s.level, s.main_char, wr.word_master_id::bigint AS wm
  FROM mem
  JOIN attempts a ON a.member_no = mem.m
  JOIN sessions s ON s.id = a.session_id AND s.level = mem.level
  JOIN word_results wr ON wr.attempt_id = a.id
  WHERE wr.reinforce_passed AND (wr.retrieve_passed OR wr.recall2_passed)
),
kn AS (   -- 학생·회차별 획득 어휘 수
  SELECT t.m, s.id AS session_id, count(DISTINCT x.word_master_id) AS known
  FROM tg t
  JOIN sess s ON s.level = t.level AND s.area_id = t.area_id
  JOIN sw x ON x.session_id = s.id
  JOIN known k ON k.m = t.m AND k.level = t.level AND k.main_char = s.main_char AND k.wm = x.word_master_id
  GROUP BY 1, 2
),
att AS (   -- 끝까지 한 훈련 기록 (결과 화면에 닿을 때마다 한 줄)
  SELECT a.member_no AS m, a.session_id, a.id, a.started_at, a.finished_at, a.duration_sec,
         a.total_words, a.retrieve_count, a.extend_count,
         row_number() OVER (PARTITION BY a.member_no, a.session_id ORDER BY a.id) AS rn
  FROM attempts a
  JOIN sess s ON s.id = a.session_id
  JOIN tg t ON t.m = a.member_no AND t.level = s.level AND t.area_id = s.area_id
),
ag AS (SELECT m, session_id, count(*) AS n, max(finished_at) AS last_finished FROM att GROUP BY 1, 2),
w1 AS (   -- 첫 훈련의 어휘별 결과 → 인출·확장·강화 숫자
  SELECT f.id AS attempt_id,
         count(*) AS n_words,
         count(*) FILTER (WHERE wr.retrieve_passed) AS n_retr,
         count(*) FILTER (WHERE wr.recall2_passed AND NOT wr.retrieve_passed) AS n_exp,
         count(*) FILTER (WHERE (wr.retrieve_passed OR wr.recall2_passed) AND nullif(btrim(swd.fill_sentence), '') IS NOT NULL) AS n_rf_total,
         count(*) FILTER (WHERE wr.reinforce_passed) AS n_rf
  FROM att f
  JOIN word_results wr ON wr.attempt_id = f.id
  LEFT JOIN session_words swd ON swd.id = wr.session_word_id
  WHERE f.rn = 1
  GROUP BY 1
),
fa AS (   -- 첫 훈련 한 줄 (어휘별 결과가 없는 옛 기록은 요약 숫자로: 강화는 알 수 없음)
  SELECT f.m, f.session_id, jsonb_build_object(
           'started_at', f.started_at, 'finished_at', f.finished_at, 'duration_sec', f.duration_sec,
           'src', CASE WHEN w.n_words > 0 THEN 'words' ELSE 'summary' END,
           'retr', CASE WHEN w.n_words > 0 THEN w.n_retr ELSE f.retrieve_count END,
           'retr_total', CASE WHEN w.n_words > 0 THEN w.n_words ELSE greatest(f.total_words, f.retrieve_count) END,
           'exp', CASE WHEN w.n_words > 0 THEN w.n_exp ELSE f.extend_count END,
           'exp_total', CASE WHEN w.n_words > 0 THEN w.n_words - w.n_retr
                             ELSE greatest(f.total_words - f.retrieve_count, f.extend_count) END,
           'rf', CASE WHEN w.n_words > 0 THEN w.n_rf END,
           'rf_total', CASE WHEN w.n_words > 0 THEN greatest(w.n_rf_total, w.n_rf) END
         ) AS j
  FROM att f LEFT JOIN w1 w ON w.attempt_id = f.id
  WHERE f.rn = 1
),
pg AS (   -- 하다 만 자리 (30일 안) — 화면 문구를 만드는 데 필요한 값만 꺼냄
  SELECT tp.member_no AS m, tp.level, tp.area_id::bigint AS area_id, tp.round_no, jsonb_build_object(
           'updated_at', tp.updated_at,
           'phase', tp.state->>'phase',
           'exact', (tp.state->'exact') = 'true'::jsonb,
           'has_fq', jsonb_typeof(tp.state->'fq') = 'object',
           'fq_idx', CASE WHEN jsonb_typeof(tp.state->'fq'->'idx') = 'number' THEN (tp.state->'fq'->>'idx')::numeric ELSE 0 END,
           'fq_n', CASE WHEN jsonb_typeof(tp.state->'fq'->'words') = 'array' THEN jsonb_array_length(tp.state->'fq'->'words') ELSE 0 END,
           'has_learn', jsonb_typeof(tp.state->'learn') = 'object',
           'learn_idx', CASE WHEN jsonb_typeof(tp.state->'learn'->'idx') = 'number' THEN (tp.state->'learn'->>'idx')::numeric ELSE 0 END,
           'learn_n', CASE WHEN jsonb_typeof(tp.state->'learn'->'words') = 'array' THEN jsonb_array_length(tp.state->'learn'->'words') ELSE 0 END,
           'recall2_n', CASE WHEN jsonb_typeof(tp.state->'S'->'recall2') = 'array' THEN jsonb_array_length(tp.state->'S'->'recall2') ELSE 0 END,
           'found_n', CASE WHEN jsonb_typeof(tp.state->'S'->'found') = 'array' THEN jsonb_array_length(tp.state->'S'->'found') ELSE 0 END
         ) AS j
  FROM training_progress tp
  JOIN tg t ON t.m = tp.member_no AND t.level = tp.level AND t.area_id = tp.area_id
  WHERE tp.updated_at >= now() - interval '30 days'
    AND jsonb_typeof(tp.state->'S') = 'object'
),
dn AS (   -- 학원에 완료(엔드데이트)를 보낸 회차 = 완료 처리된 입장권이 있음
  SELECT si.user_no AS m, coalesce(si.training_level, '초등') AS level, si.training_area AS slug,
         si.training_round AS rnd, min(si.completed_at) AS first_done
  FROM session_init si
  WHERE si.user_no IN (SELECT m FROM tg) AND si.training_mode <> 'report' AND si.completed_at IS NOT NULL
  GROUP BY 1, 2, 3, 4
),
rv AS (   -- 복습 횟수 = 복습 입장권을 실제로 연 횟수
  SELECT si.user_no AS m, si.training_level AS level, si.training_area AS slug, si.training_round AS rnd, count(*) AS n
  FROM session_init si
  WHERE si.user_no IN (SELECT m FROM tg) AND si.training_mode = 'review' AND si.used_at IS NOT NULL
  GROUP BY 1, 2, 3, 4
),
rd AS (   -- 학생·회차 한 줄
  SELECT t.m, t.level, t.area_id, s.round_no, s.main_char,
         (SELECT mc.char_hangul FROM main_chars mc WHERE mc.char = s.main_char LIMIT 1) AS main_hun,
         coalesce(tot.total, 0) AS total, coalesce(kn.known, 0) AS known,
         coalesce(ag.n, 0) AS tries, ag.last_finished,
         dn.m IS NOT NULL AS done, dn.first_done,
         coalesce(rv.n, 0) AS reviews,
         fa.j AS first_try, pg.j AS prog
  FROM tg t
  JOIN sess s ON s.level = t.level AND s.area_id = t.area_id
  LEFT JOIN tot ON tot.session_id = s.id
  LEFT JOIN kn ON kn.m = t.m AND kn.session_id = s.id
  LEFT JOIN ag ON ag.m = t.m AND ag.session_id = s.id
  LEFT JOIN fa ON fa.m = t.m AND fa.session_id = s.id
  LEFT JOIN pg ON pg.m = t.m AND pg.level = t.level AND pg.area_id = t.area_id AND pg.round_no = s.round_no
  LEFT JOIN dn ON dn.m = t.m AND dn.level = t.level AND dn.slug = s.slug AND dn.rnd = s.round_no
  LEFT JOIN rv ON rv.m = t.m AND rv.level = t.level AND rv.slug = s.slug AND rv.rnd = s.round_no
),
ta AS (   -- 실력 점검 응시 기록
  SELECT x.id, x.member_no AS m, x.level, x.area_id, x.unit, x.round_from, x.round_to, x.status,
         x.started_at, x.finished_at, x.duration_ms, x.n_known, x.n_hanja, x.n_hanja_wrong, x.n_wrong, x.score,
         coalesce(x.n_known, 0) + coalesce(x.n_hanja, 0) + coalesce(x.n_hanja_wrong, 0) + coalesce(x.n_wrong, 0) AS nq
  FROM test_attempts x
  JOIN tg t ON t.m = x.member_no AND t.level = x.level AND t.area_id = x.area_id
),
ta_sum AS (
  SELECT m, level, area_id, unit,
         count(*) FILTER (WHERE status = 'done') AS tries,
         max(score) FILTER (WHERE status = 'done') AS best,
         (array_agg(score ORDER BY started_at) FILTER (WHERE status = 'done'))[1] AS first,
         (array_agg(score ORDER BY started_at DESC) FILTER (WHERE status = 'done'))[1] AS last,
         bool_or(status = 'in_progress') AS open
  FROM ta GROUP BY 1, 2, 3, 4
),
ta_best AS (   -- 가장 높은 점수를 받은 응시 (같은 점수면 먼저 본 것)
  SELECT DISTINCT ON (m, level, area_id, unit) m, level, area_id, unit,
         started_at, finished_at, duration_ms, n_known, n_hanja, n_hanja_wrong, n_wrong, score, nq
  FROM ta WHERE status = 'done'
  ORDER BY m, level, area_id, unit, score DESC NULLS LAST, started_at
),
un_r AS (   -- 5회차 묶음별 훈련·통과 회차 수 (통과 = 회차 어휘의 80% 이상 획득, 실력 점검 자격과 같은 기준)
  SELECT m, level, area_id, ((round_no - 1) / 5 + 1)::int AS unit,
         count(*) FILTER (WHERE tries > 0) AS trained,
         count(*) FILTER (WHERE tries > 0 AND total > 0 AND known * 10 >= total * 8) AS passed
  FROM rd GROUP BY 1, 2, 3, 4
),
un AS (
  SELECT r.m, r.level, r.area_id, r.unit, r.trained, r.passed,
         coalesce(s.tries, 0) AS tries, s.best, s.first, s.last, coalesce(s.open, false) AS open,
         b.started_at, b.finished_at, b.duration_ms, b.n_known, b.n_hanja, b.n_hanja_wrong, b.n_wrong, b.nq
  FROM un_r r
  LEFT JOIN ta_sum s ON s.m = r.m AND s.level = r.level AND s.area_id = r.area_id AND s.unit = r.unit
  LEFT JOIN ta_best b ON b.m = r.m AND b.level = r.level AND b.area_id = r.area_id AND b.unit = r.unit
  WHERE r.trained > 0 OR s.m IS NOT NULL
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'm', t.m, 'level', t.level, 'area_id', t.area_id,
  'rounds', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'round', r.round_no, 'main_char', r.main_char, 'main_hun', r.main_hun,
             'total', r.total, 'known', r.known, 'trained', r.tries > 0, 'tries', r.tries,
             'last_finished', r.last_finished, 'done', r.done, 'first_done', r.first_done,
             'reviews', r.reviews, 'first_try', r.first_try, 'prog', r.prog
           ) ORDER BY r.round_no), '[]'::jsonb)
    FROM rd r
    WHERE r.m = t.m AND r.level = t.level AND r.area_id = t.area_id AND (r.tries > 0 OR r.prog IS NOT NULL)
  ),
  'units', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'unit', u.unit, 'trained', u.trained, 'passed', u.passed,
             'tries', u.tries, 'best', u.best, 'first', u.first, 'last', u.last, 'open', u.open,
             'started_at', u.started_at, 'finished_at', u.finished_at, 'duration_ms', u.duration_ms,
             'n_known', u.n_known, 'n_hanja', u.n_hanja, 'n_hanja_wrong', u.n_hanja_wrong, 'n_wrong', u.n_wrong, 'nq', u.nq
           ) ORDER BY u.unit), '[]'::jsonb)
    FROM un u
    WHERE u.m = t.m AND u.level = t.level AND u.area_id = t.area_id
  )
) ORDER BY t.m, t.level, t.area_id), '[]'::jsonb)
FROM tg t;
$$;
REVOKE ALL ON FUNCTION public.wordsense_rounds_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wordsense_rounds_batch(jsonb) TO service_role;
