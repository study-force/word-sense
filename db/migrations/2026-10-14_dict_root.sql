-- ════════════════════════════════════════════════════════════════
-- 어근 룩업 (dict_root) + classify_word_input v7
-- Date: 2026-10-14 (대표님 요청)
--   '생생'처럼 국립국어원이 단어가 아닌 「어근」으로 보는 말(표준국어대사전 「품사 없음」)을 입력하면
--   "사전에 없어요" 대신 "혼자서는 쓰이지 않고 '생생하다', '생생히'처럼 써요"로 안내.
--   데이터: db/build_dict_root.js → db/dict_root_stdict.csv (2,489개)를 이 테이블에 적재.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.dict_root (
  word  TEXT PRIMARY KEY,
  hanja TEXT,
  forms TEXT[] NOT NULL
);
ALTER TABLE public.dict_root ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dict_root_read ON public.dict_root;
CREATE POLICY dict_root_read ON public.dict_root FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.dict_root TO anon, authenticated;
