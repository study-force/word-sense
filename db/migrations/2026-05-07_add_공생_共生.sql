-- ════════════════════════════════════════════════════════════════
-- Migration: 공생(共生) 1회차 가족 어휘 추가
-- Date: 2026-05-07
--
-- 배경:
--   학생이 1회차에서 "공생" 입력했는데 미등록 응답 발생.
--   • 박차장님 검수본에 공생 누락
--   • dict_lookup에도 누락 — 표준국어대사전이 동음이의어를 "공생(01)~(04)"
--     형식으로 등재해 우리 파서가 2자 한글 정규식에서 걸러냄
--
--   寄生 추가와 같은 패턴. 1회차(生·생물)에 共生 직접 INSERT.
--
-- 적용:
--   Supabase Studio → SQL Editor → 이 파일 RUN
-- ════════════════════════════════════════════════════════════════


-- (1) word_master 추가
INSERT INTO word_master (word, hanja, char1, hun1, char2, hun2, meaning, grade)
VALUES
  ('공생', '共生', '共', '함께 공', '生', '날 생',
   '여러 생물이 서로 도우며 함께 살아감.',
   3)
ON CONFLICT (word, hanja) DO UPDATE SET
  char1   = EXCLUDED.char1,
  hun1    = EXCLUDED.hun1,
  char2   = EXCLUDED.char2,
  hun2    = EXCLUDED.hun2,
  meaning = EXCLUDED.meaning,
  grade   = EXCLUDED.grade,
  updated_at = NOW();


-- (2) session_words 추가 — 1회차(生)에 가족 어휘로 등록
--     기생(寄生)과 변별 페어 — 4지선다 오답에 기생 의미 포함하여 학습 효과 ↑
INSERT INTO session_words (
  session_id, word_master_id, fill_sentence, choices, is_infer_quiz, order_in_session
)
SELECT
  s.id,
  wm.id,
  '악어와 악어새는 서로 도움을 주고받으며 ___ 관계를 이룬다.',
  jsonb_build_array(
    jsonb_build_object('text', '여러 생물이 서로 도우며 함께 살아감',     'is_correct', true),
    jsonb_build_object('text', '다른 생물에 붙어 양분을 얻으며 살아감',   'is_correct', false),
    jsonb_build_object('text', '한 생물이 혼자서 양분을 만들며 살아감',   'is_correct', false),
    jsonb_build_object('text', '여러 생물이 서로 다투며 영역을 차지함',   'is_correct', false)
  ),
  false,
  COALESCE((SELECT MAX(order_in_session) FROM session_words WHERE session_id = s.id), 0) + 1
FROM sessions s
JOIN areas a ON a.id = s.area_id
CROSS JOIN word_master wm
WHERE a.slug = 'biology'
  AND s.round_no = 1
  AND wm.word = '공생' AND wm.hanja = '共生'
ON CONFLICT (session_id, word_master_id) DO NOTHING;


-- ════════════════════════════════════════
-- 검증
-- ════════════════════════════════════════

-- (a) word_master에 공생(共生) 등록 확인
SELECT id, word, hanja, char1, hun1, char2, hun2, grade, meaning
FROM word_master
WHERE word = '공생';

-- (b) 1회차에 공생(共生) session_words 등록 확인
SELECT s.round_no, sw.order_in_session, wm.word, wm.hanja, wm.meaning
FROM session_words sw
JOIN sessions s ON s.id = sw.session_id
JOIN areas a ON a.id = s.area_id
JOIN word_master wm ON wm.id = sw.word_master_id
WHERE a.slug = 'biology' AND s.round_no = 1 AND wm.word = '공생';

-- (c) 1회차 전체 어휘 수 확인
SELECT s.round_no, COUNT(*) AS family_word_count
FROM session_words sw
JOIN sessions s ON s.id = sw.session_id
JOIN areas a ON a.id = s.area_id
WHERE a.slug = 'biology' AND s.round_no = 1
GROUP BY s.round_no;
