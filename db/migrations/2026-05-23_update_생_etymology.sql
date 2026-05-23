-- ════════════════════════════════════════════════════════════════
-- Migration: 1회차(생) 어원 텍스트 업데이트 — 학생 친화 말투
-- Date: 2026-05-23
--
-- 변경:
--   "글자입니다 / 넓어졌습니다" 격식체 → "글자예요 / 넓어졌어요" 친근체
--   시작 부분에 "'날 생'은" 추가 — 어원 나레이션과 동일 문구.
--
-- 적용:
--   Supabase Studio → SQL Editor → 이 파일 RUN (운영/개발 양쪽).
-- ════════════════════════════════════════════════════════════════

UPDATE sessions
SET main_etymology = $$'날 생'은 땅(一) 위로 새싹(屮)이 돋아나는 모습을 본떠 만든 글자예요. 처음 '태어나다'의 뜻에서 출발해, '살아가다', '신선하다', '~을 하는 사람'까지 의미가 넓어졌어요.$$
WHERE area_id = (SELECT id FROM areas WHERE slug = 'biology')
  AND round_no = 1;

-- 검증
SELECT round_no, main_char, main_etymology
FROM sessions s
JOIN areas a ON a.id = s.area_id
WHERE a.slug = 'biology' AND s.round_no = 1;
