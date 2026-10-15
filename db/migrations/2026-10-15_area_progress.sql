-- ════════════════════════════════════════════════════════════════
-- 훈사전 회차별 누적 (대표님 2026-10-15)
--   학생의 한 영역·과정 회차별 { round, total(출제 어휘 수), known(누적 내 어휘 수), trained(훈련한 적 있음) }
--   · total: 회차 출제 어휘 (중등은 主字가 들어간 초등 어휘 포함 — 통계 RPC와 같은 기준)
--   · known: 과정별 '내 어휘'(wordsense_known_words) 중 이 회차 어휘에 속한 수
--   wordsense-session이 service_role로 호출 → 앱 훈사전이 과거 회차까지 실제 기록으로 표시
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.wordsense_area_progress(p_member_no bigint, p_area_id bigint, p_level text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
WITH lvl_sess AS (
  SELECT id, round_no, main_char FROM sessions WHERE level = p_level AND area_id = p_area_id
),
sw AS (
  SELECT s.id AS session_id, sw.word_master_id
  FROM lvl_sess s JOIN session_words sw ON sw.session_id = s.id
  UNION
  SELECT s.id, sw.word_master_id
  FROM lvl_sess s
  JOIN word_master w ON p_level = '중등' AND position(s.main_char in w.hanja) > 0
  JOIN session_words sw ON sw.word_master_id = w.id
  JOIN sessions e ON e.id = sw.session_id AND e.level = '초등'
),
known AS (SELECT unnest(wordsense_known_words(p_member_no, p_level)) AS wm),
att AS (SELECT DISTINCT session_id FROM attempts WHERE member_no = p_member_no)
SELECT coalesce(jsonb_agg(jsonb_build_object(
         'round',   s.round_no,
         'total',   (SELECT count(DISTINCT x.word_master_id) FROM sw x WHERE x.session_id = s.id),
         'known',   (SELECT count(DISTINCT x.word_master_id) FROM sw x JOIN known k ON k.wm = x.word_master_id WHERE x.session_id = s.id),
         'trained', s.id IN (SELECT session_id FROM att)
       ) ORDER BY s.round_no), '[]'::jsonb)
FROM lvl_sess s;
$$;
REVOKE ALL ON FUNCTION public.wordsense_area_progress(bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wordsense_area_progress(bigint, bigint, text) TO service_role;
