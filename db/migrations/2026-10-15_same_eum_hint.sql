-- 소리(음) 기준 안내로 변경 (대표님 2026-10-15)
--   아이들은 음을 보고 어휘를 적으므로, 主字의 음과 같은 소리가 들어간 어휘만 안내
--   1) 훈도 같은 다른 한자: 不 회차 '부인'(否) → "뜻은 같지만 아니 불(不)과는 다른 한자예요."
--   2) 소리만 같은 한자:   不 회차 '농부'(夫)·'어부' → "소리는 같지만 아니 불(不)과는 뜻이 다른 한자예요."
--   음이 다른 경우(生 회차 '일기'의 날 일(日) 등)는 안내하지 않음 → 기존 "가족 어휘가 아니에요."
CREATE OR REPLACE FUNCTION public.wordsense_same_hun_hint(p_word text, p_main_char text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_keys     text[];
  v_eums     text[];
  v_main     text;
  v_dl       RECORD;
  v_pass     int;
  i          int;
  ch         text;
  syl        text;
  v_same     boolean;
  v_disp     text;
  c          int;
  v_topic    text;
  v_cop      text;
  v_with     text;
BEGIN
  SELECT array_agg(DISTINCT wordsense_hun_key(hun)), array_agg(DISTINCT split_part(trim(hun), ' ', -1))
    INTO v_keys, v_eums FROM wordsense_char_huns(p_main_char);
  IF v_eums IS NULL THEN RETURN NULL; END IF;
  SELECT char_hangul INTO v_main FROM main_chars WHERE char = p_main_char LIMIT 1;
  IF v_main IS NULL THEN
    SELECT hun INTO v_main FROM wordsense_char_huns(p_main_char) ORDER BY n DESC LIMIT 1;
  END IF;

  -- 1차: 훈까지 같은 한자를 모든 한자 표기에서 먼저 찾고, 없으면 2차: 소리만 같은 한자
  FOR v_pass IN 1..2 LOOP
    FOR v_dl IN
      -- '漁夫漁父'처럼 붙은 표기는 나누고, 우리 어휘표에 있는 표기 → 흔히 쓰는 한자로 된 표기 순
      SELECT x.hanja FROM (
        SELECT substr(d.hanja, (g - 1) * char_length(p_word) + 1, char_length(p_word)) AS hanja, d.source, d.id
        FROM dict_lookup d, generate_series(1, char_length(d.hanja) / char_length(p_word)) g
        WHERE d.word = p_word AND d.word_type = 1 AND char_length(d.hanja) % char_length(p_word) = 0
      ) x
      ORDER BY EXISTS (SELECT 1 FROM word_master w WHERE w.word = p_word AND w.hanja = x.hanja) DESC,
               (SELECT count(*) FROM word_master w, generate_series(1, char_length(x.hanja)) k
                 WHERE w.char1 = substr(x.hanja, k, 1) OR w.char2 = substr(x.hanja, k, 1)) DESC,
               x.source, x.id
    LOOP
      FOR i IN 1..char_length(p_word) LOOP
        ch := substr(v_dl.hanja, i, 1);
        syl := substr(p_word, i, 1);
        CONTINUE WHEN ch = p_main_char OR NOT (syl = ANY(v_eums));
        SELECT bool_or(wordsense_hun_key(h.hun) = ANY(v_keys)) INTO v_same FROM wordsense_char_huns(ch) h;
        CONTINUE WHEN v_same IS NULL;                       -- 훈음을 모르는 한자는 건너뜀
        CONTINUE WHEN (v_pass = 1) <> v_same;
        -- 보여줄 훈음: 그 어휘 속 소리와 같은 것 우선, 그다음 많이 쓰인 것
        SELECT h.hun INTO v_disp FROM wordsense_char_huns(ch) h
        ORDER BY (split_part(trim(h.hun), ' ', -1) = syl) DESC, h.n DESC LIMIT 1;

        c := ascii(syl);
        v_topic := CASE WHEN c BETWEEN 44032 AND 55203 AND (c - 44032) % 28 > 0 THEN '은' ELSE '는' END;
        c := ascii(substr(v_disp, length(v_disp), 1));
        v_cop := CASE WHEN c BETWEEN 44032 AND 55203 AND (c - 44032) % 28 > 0 THEN '이에요' ELSE '예요' END;
        c := ascii(substr(v_main, length(v_main), 1));
        v_with := CASE WHEN c BETWEEN 44032 AND 55203 AND (c - 44032) % 28 > 0 THEN '과' ELSE '와' END;

        RETURN jsonb_build_object(
          'result', CASE WHEN v_same THEN 'same_hun' ELSE 'same_eum' END,
          'word', p_word, 'hanja', v_dl.hanja, 'char', ch,
          'message', '''' || p_word || '''의 ''' || syl || '''' || v_topic || ' ' || v_disp || '(' || ch || ')' || v_cop || '. '
                     || CASE WHEN v_same
                          THEN '뜻은 같지만 ' || v_main || '(' || p_main_char || ')' || v_with || '는 다른 한자예요.'
                          ELSE '소리는 같지만 ' || v_main || '(' || p_main_char || ')' || v_with || '는 뜻이 다른 한자예요.' END);
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$;
