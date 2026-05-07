-- ════════════════════════════════════════════════════════════════
-- Migration: word_master 동음이의어 지원
-- Date: 2026-05-07
--
-- 변경:
--   • word_master.word UNIQUE 제약 → (word, hanja) UNIQUE 로 변경
--   • 한글 같지만 한자 다른 동음이의어 별개 행 등재 가능
--
-- 배경:
--   박차장님 검수본에 201쌍의 동음이의어가 있는데, 현재 한 한자 표기만 가능.
--   특히 학습 가치 큰 寄生(생물·기생) 같은 어휘가 누락됨 — 妓生(조선시대 기생)만 있음.
--
-- 적용:
--   Supabase Studio → SQL Editor → 이 파일 RUN
--
-- 영향:
--   • 기존 데이터 영향 없음 (UNIQUE 제약 완화 방향이라 충돌 없음)
--   • 향후 동일 한글 + 다른 한자 INSERT 가능
--   • RPC classify_word_input 동작 자연스럽게 유지 (LIMIT 1로 첫 매칭, ORDER BY로 안정)
-- ════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════
-- 1. UNIQUE 제약 변경 (idempotent — 재실행 안전)
-- ════════════════════════════════════════

-- 기존 UNIQUE(word) 제약 제거
ALTER TABLE word_master DROP CONSTRAINT IF EXISTS word_master_word_key;

-- 이미 새 제약이 있으면 한 번 제거 후 재추가 (재실행 시 에러 방지)
ALTER TABLE word_master DROP CONSTRAINT IF EXISTS word_master_word_hanja_key;

-- 새 UNIQUE(word, hanja) 제약 추가
ALTER TABLE word_master
  ADD CONSTRAINT word_master_word_hanja_key UNIQUE (word, hanja);

-- 확인
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'word_master'::regclass
  AND contype = 'u';


-- ════════════════════════════════════════
-- 2. 寄生 (생물) — 누락된 동음이의어 직접 추가 (B-1 시범)
-- ════════════════════════════════════════
-- 박차장님 검수본에 妓生만 있고 寄生 없음. 1회차(生·생물) 가족 어휘로 합당.
-- 정답 풀이 정책 (4.4절): 두 한자의 훈을 살림 + 한자 노출 금지 + 1~2문장.

-- (1) word_master 추가
INSERT INTO word_master (word, hanja, char1, hun1, char2, hun2, meaning, grade)
VALUES
  ('기생', '寄生', '寄', '맡길 기', '生', '날 생',
   '다른 생물에 붙어 양분을 얻으며 살아감.',
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
--     fill_sentence/choices는 초안. 검수 시 다듬기.
INSERT INTO session_words (
  session_id, word_master_id, fill_sentence, choices, is_infer_quiz, order_in_session
)
SELECT
  s.id,
  wm.id,
  '벼룩은 동물의 몸에 붙어 ___ 생활을 하며 피를 빨아먹는다.',
  jsonb_build_array(
    jsonb_build_object('text', '다른 생물에 붙어 양분을 얻으며 살아감', 'is_correct', true),
    jsonb_build_object('text', '여러 생물이 어울려 함께 살아감',         'is_correct', false),
    jsonb_build_object('text', '스스로 양분을 만들며 자라남',             'is_correct', false),
    jsonb_build_object('text', '한 곳에 머물러 오래 자라남',              'is_correct', false)
  ),
  false,
  -- 회차 끝번에 추가
  COALESCE((SELECT MAX(order_in_session) FROM session_words WHERE session_id = s.id), 0) + 1
FROM sessions s
JOIN areas a ON a.id = s.area_id
CROSS JOIN word_master wm
WHERE a.slug = 'biology'
  AND s.round_no = 1
  AND wm.word = '기생' AND wm.hanja = '寄生'
ON CONFLICT (session_id, word_master_id) DO NOTHING;


-- ════════════════════════════════════════
-- 3. 검증
-- ════════════════════════════════════════

-- (a) word_master에 기생 두 행 확인 (妓生 + 寄生)
SELECT id, word, hanja, char1, hun1, char2, hun2, grade, meaning
FROM word_master
WHERE word = '기생'
ORDER BY hanja;

-- (b) session_words 1회차에 기생(寄生) 등록됐는지
SELECT s.round_no, sw.order_in_session, wm.word, wm.hanja, sw.is_infer_quiz
FROM session_words sw
JOIN sessions s ON s.id = sw.session_id
JOIN areas a ON a.id = s.area_id
JOIN word_master wm ON wm.id = sw.word_master_id
WHERE a.slug = 'biology' AND s.round_no = 1 AND wm.word = '기생'
ORDER BY wm.hanja;

-- (c) classify_word_input — 기생/生 입력 시 寄生 매칭되는지
SELECT classify_word_input('기생', '生') AS test_寄生_via_curriculum;
-- 예상: result=correct, message="꽤 어려운 어휘를 알고 있네요..." 또는 hanja에 寄生
