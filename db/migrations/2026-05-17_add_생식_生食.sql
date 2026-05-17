-- ════════════════════════════════════════════════════════════════
-- Migration: 1회차에 생식(生食) 동음이의어 추가
-- Date: 2026-05-17
--
-- 배경:
--   현재 word_master에 생식 [生殖, 번식] 한 entry만 등록.
--   동음이의어 [生食, 날로 먹기] 추가 시 게임에서 "생식" 입력하면
--   동음이의어 quiz(어느 한자를 의미하는지 선택) 자동 발동.
--
-- 적용:
--   Supabase Studio → SQL Editor → 이 파일 RUN
--   (운영/개발 DB 각각 1번씩)
-- ════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════
-- 1. word_master 추가 — 생식 [生食]
-- ════════════════════════════════════════
INSERT INTO word_master (word, hanja, char1, hun1, char2, hun2, meaning, grade)
VALUES
  ('생식', '生食', '生', '날 생', '食', '먹을 식',
   '익히지 않고 날것 그대로 먹음, 또는 그러한 음식.',
   3)
ON CONFLICT (word, hanja) DO UPDATE SET
  char1   = EXCLUDED.char1,
  hun1    = EXCLUDED.hun1,
  char2   = EXCLUDED.char2,
  hun2    = EXCLUDED.hun2,
  meaning = EXCLUDED.meaning,
  grade   = EXCLUDED.grade,
  updated_at = NOW();


-- ════════════════════════════════════════
-- 2. session_words 추가 — 1회차(生) 끝번에 등록
-- ════════════════════════════════════════
INSERT INTO session_words (
  session_id, word_master_id, fill_sentence, choices, is_infer_quiz, order_in_session
)
SELECT
  s.id,
  wm.id,
  '회는 신선한 생선을 ___하는 음식이라 손질이 무엇보다 중요하다.',
  jsonb_build_array(
    jsonb_build_object('text', '익히지 않고 날것 그대로 먹음',  'is_correct', true),
    jsonb_build_object('text', '오랜 시간 푹 삶아서 먹음',      'is_correct', false),
    jsonb_build_object('text', '센 불에 굽거나 튀겨서 먹음',    'is_correct', false),
    jsonb_build_object('text', '말려서 오래 보관해 두고 먹음',  'is_correct', false)
  ),
  false,
  COALESCE((SELECT MAX(order_in_session) FROM session_words WHERE session_id = s.id), 0) + 1
FROM sessions s
JOIN areas a ON a.id = s.area_id
CROSS JOIN word_master wm
WHERE a.slug = 'biology'
  AND s.round_no = 1
  AND wm.word = '생식' AND wm.hanja = '生食'
ON CONFLICT (session_id, word_master_id) DO NOTHING;


-- ════════════════════════════════════════
-- 3. 검증
-- ════════════════════════════════════════

-- (a) word_master에 생식 두 행 확인 (生殖 + 生食)
SELECT id, word, hanja, char1, hun1, char2, hun2, grade, meaning
FROM word_master
WHERE word = '생식'
ORDER BY hanja;

-- (b) session_words 1회차에 생식 두 entry 모두 있는지
SELECT s.round_no, sw.order_in_session, wm.word, wm.hanja, sw.is_infer_quiz
FROM session_words sw
JOIN sessions s ON s.id = sw.session_id
JOIN areas a ON a.id = s.area_id
JOIN word_master wm ON wm.id = sw.word_master_id
WHERE a.slug = 'biology' AND s.round_no = 1 AND wm.word = '생식'
ORDER BY wm.hanja;
