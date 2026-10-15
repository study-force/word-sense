-- 사전 한자어 속 훈음 없던 한자(약 2,900자)의 훈음 보강 (대표님 2026-10-16, 방법 ②)
--   출처: 다음 한자사전 대표 훈음(sub_read) — "실제 한자 훈만" 원칙. 한 글자에 읽기가 여러 개면 모두(ord 순)
--   쓰임: 입력 안내(wordsense_same_hun_hint)만. 학습 콘텐츠(word_master·main_chars)는 건드리지 않음
--   예: 찬합 → "'찬합'의 '합'은 합 합(盒)이에요. 소리는 같지만 합할 합(合)과는 뜻이 다른 한자예요."
CREATE TABLE IF NOT EXISTS public.hanja_hun_ext (
  char       text NOT NULL,
  ord        int  NOT NULL,
  hun        text NOT NULL,
  source     text NOT NULL DEFAULT 'daum',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (char, ord)
);
ALTER TABLE public.hanja_hun_ext ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hanja_hun_ext_read ON public.hanja_hun_ext;
CREATE POLICY hanja_hun_ext_read ON public.hanja_hun_ext FOR SELECT TO anon, authenticated USING (true);

-- 훈음 목록에 보강 표 추가 — 우리 표(主字·어휘)에 있는 글자는 우리 표가 우선(보강 표는 그 글자가 우리 표에 없을 때만)
CREATE OR REPLACE FUNCTION public.wordsense_char_huns(p_char text)
RETURNS TABLE(hun text, n bigint) LANGUAGE sql STABLE AS $$
  WITH ours AS (
    SELECT h FROM (
      SELECT char_hangul AS h FROM main_chars WHERE char = p_char
      UNION ALL SELECT hun1 FROM word_master WHERE char1 = p_char AND hun1 IS NOT NULL
      UNION ALL SELECT hun2 FROM word_master WHERE char2 = p_char AND hun2 IS NOT NULL
    ) x WHERE trim(h) <> ''
  )
  SELECT h, count(*) FROM ours GROUP BY h
  UNION ALL
  -- 보강 표: 첫 읽기(대표 훈음)가 가장 많이 쓰인 것처럼 앞에 오도록 n을 역순으로
  SELECT e.hun, (100 - e.ord)::bigint FROM hanja_hun_ext e
  WHERE e.char = p_char AND NOT EXISTS (SELECT 1 FROM ours)
$$;
