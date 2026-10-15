-- 입력 판정 개선 (대표님 2026-10-15)
--  1) 학습 목록에서 뺀 신체·성 관련 어휘 → "이 어휘도 날 생(生)의 가족 어휘예요." (점수 X, 비하어는 기존 안내 유지)
--  2) 主字와 훈이 같은 다른 한자로 된 어휘 → "'부인'의 '부'는 아닐 부(否)예요. 뜻은 같지만 아니 불(不)과는 다른 한자예요."
--     (전에는 "아니 불(不)의 가족 어휘가 아니에요."라고만 나와 아이가 헷갈렸음)

-- 훈 비교용 열쇠: '아닐 부' → '아닐' → 끝 받침 ㄹ 떼기 → '아니'  ('아니 불'도 '아니')
CREATE OR REPLACE FUNCTION public.wordsense_hun_key(h text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; c int;
BEGIN
  k := trim(regexp_replace(trim(COALESCE(h, '')), '\s*\S+$', ''));
  IF k = '' THEN RETURN NULL; END IF;
  c := ascii(substr(k, length(k), 1));
  IF c BETWEEN 44032 AND 55203 AND (c - 44032) % 28 = 8 THEN
    k := substr(k, 1, length(k) - 1) || chr(c - 8);
  END IF;
  RETURN k;
END $$;

-- 한자 한 글자의 훈음 목록 (主字 표 + 어휘 표에 쓰인 것)
CREATE OR REPLACE FUNCTION public.wordsense_char_huns(p_char text)
RETURNS TABLE(hun text, n bigint) LANGUAGE sql STABLE AS $$
  SELECT h, count(*) FROM (
    SELECT char_hangul AS h FROM main_chars WHERE char = p_char
    UNION ALL SELECT hun1 FROM word_master WHERE char1 = p_char AND hun1 IS NOT NULL
    UNION ALL SELECT hun2 FROM word_master WHERE char2 = p_char AND hun2 IS NOT NULL
  ) x WHERE trim(h) <> '' GROUP BY h
$$;

CREATE OR REPLACE FUNCTION public.wordsense_same_hun_hint(p_word text, p_main_char text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_keys     text[];
  v_main     text;
  v_dl       RECORD;
  i          int;
  ch         text;
  syl        text;
  v_key      text;
  v_disp     text;
  c          int;
  v_topic    text;
  v_cop      text;
  v_with     text;
BEGIN
  SELECT array_agg(DISTINCT wordsense_hun_key(hun)) INTO v_keys FROM wordsense_char_huns(p_main_char);
  IF v_keys IS NULL THEN RETURN NULL; END IF;
  SELECT char_hangul INTO v_main FROM main_chars WHERE char = p_main_char LIMIT 1;
  IF v_main IS NULL THEN
    SELECT hun INTO v_main FROM wordsense_char_huns(p_main_char) ORDER BY n DESC LIMIT 1;
  END IF;

  FOR v_dl IN
    SELECT hanja FROM dict_lookup
    WHERE word = p_word AND word_type = 1 AND char_length(hanja) = char_length(p_word)
    ORDER BY source ASC
  LOOP
    FOR i IN 1..char_length(p_word) LOOP
      ch := substr(v_dl.hanja, i, 1);
      CONTINUE WHEN ch = p_main_char;
      syl := substr(p_word, i, 1);
      SELECT wordsense_hun_key(h.hun) INTO v_key FROM wordsense_char_huns(ch) h
      WHERE wordsense_hun_key(h.hun) = ANY(v_keys) LIMIT 1;
      CONTINUE WHEN v_key IS NULL;
      -- 보여줄 훈음: 그 어휘 속 소리와 같은 것 우선, 그다음 많이 쓰인 것
      SELECT h.hun INTO v_disp FROM wordsense_char_huns(ch) h
      ORDER BY (split_part(h.hun, ' ', 2) = syl) DESC, (wordsense_hun_key(h.hun) = v_key) DESC, h.n DESC LIMIT 1;

      c := ascii(syl);
      v_topic := CASE WHEN c BETWEEN 44032 AND 55203 AND (c - 44032) % 28 > 0 THEN '은' ELSE '는' END;
      c := ascii(substr(v_disp, length(v_disp), 1));
      v_cop := CASE WHEN c BETWEEN 44032 AND 55203 AND (c - 44032) % 28 > 0 THEN '이에요' ELSE '예요' END;
      c := ascii(substr(v_main, length(v_main), 1));
      v_with := CASE WHEN c BETWEEN 44032 AND 55203 AND (c - 44032) % 28 > 0 THEN '과' ELSE '와' END;

      RETURN jsonb_build_object(
        'result', 'same_hun', 'word', p_word, 'hanja', v_dl.hanja, 'char', ch,
        'message', '''' || p_word || '''의 ''' || syl || '''' || v_topic || ' ' || v_disp || '(' || ch || ')' || v_cop || '. '
                   -- 한 글자 훈(예: 날 일/날 생)은 뜻이 다른 경우가 많아 "뜻은 같지만"을 빼고 안내
                   || CASE WHEN char_length(v_key) >= 2 THEN '뜻은 같지만 ' ELSE '' END
                   || v_main || '(' || p_main_char || ')' || v_with || '는 다른 한자예요.');
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.classify_word_input(p_word text, p_main_char text, p_level text DEFAULT '초등'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_match_in_curriculum RECORD;
  v_match               RECORD;
  v_msg                 TEXT;
  v_result              TEXT;
  v_matches             JSONB;
  v_particle            TEXT;
  v_same_level          BOOLEAN;
  v_in_middle           BOOLEAN;
  v_root                RECORD;
  v_topic               TEXT;
  v_main_hun            TEXT;
  v_same                JSONB;
BEGIN
  p_word := COALESCE(TRIM(p_word), '');
  p_main_char := COALESCE(TRIM(p_main_char), '');
  p_level := CASE WHEN p_level = '중등' THEN '중등' ELSE '초등' END;
  IF p_word = '' OR p_main_char = '' THEN
    RETURN jsonb_build_object('result', 'invalid_input', 'message', '입력이 비어 있어요.');
  END IF;

  IF length(p_word) > 0 AND
     ascii(substr(p_word, length(p_word), 1)) BETWEEN 44032 AND 55203 AND
     ((ascii(substr(p_word, length(p_word), 1)) - 44032) % 28) > 0
  THEN v_particle := '을'; ELSE v_particle := '를';
  END IF;

  SELECT wm.* INTO v_match_in_curriculum
  FROM word_master wm
  WHERE wm.word = p_word AND (wm.char1 = p_main_char OR wm.char2 = p_main_char) LIMIT 1;
  IF FOUND AND v_match_in_curriculum.sensitive = 'slur' THEN
    RETURN jsonb_build_object('result','slur','message','남을 낮잡아 이르는 말이라 쓰지 않는 게 좋아요.','word',v_match_in_curriculum.word);
  END IF;
  IF FOUND AND v_match_in_curriculum.sensitive IS NOT NULL THEN
    -- 신체·성 관련 어휘: 학습 목록에서는 뺐지만(2026-10-15) 主字 가족인 건 맞으니 사실대로 안내. 점수 X
    SELECT mc.char_hangul INTO v_main_hun FROM main_chars mc WHERE mc.char = p_main_char LIMIT 1;
    RETURN jsonb_build_object('result','sensitive','word',v_match_in_curriculum.word,
      'message','이 어휘도 ' || COALESCE(v_main_hun || '(' || p_main_char || ')', p_main_char) || '의 가족 어휘예요.');
  END IF;
  IF FOUND THEN
    -- 이 학생이 실제로 만날 수 있는 회차에 나오는지 (같은 낱말·主字 포함 entry 전부 기준)
    SELECT EXISTS (
      SELECT 1
      FROM word_master wm
      JOIN session_words sw ON sw.word_master_id = wm.id
      JOIN sessions s ON s.id = sw.session_id
      WHERE wm.word = p_word AND (wm.char1 = p_main_char OR wm.char2 = p_main_char)
        AND ( s.level = p_level
              OR (p_level = '중등' AND s.level = '초등'           -- 중등: 主字가 들어간 초등 어휘는 중등 회차에도 나옴 (2026-10-15)
                  AND EXISTS (SELECT 1 FROM sessions m WHERE m.level = '중등' AND position(m.main_char in wm.hanja) > 0)) )
    ) INTO v_same_level;

    SELECT EXISTS (
      SELECT 1
      FROM word_master wm
      JOIN session_words sw ON sw.word_master_id = wm.id
      JOIN sessions s ON s.id = sw.session_id
      WHERE wm.word = p_word AND (wm.char1 = p_main_char OR wm.char2 = p_main_char)
        AND s.level = '중등'
    ) INTO v_in_middle;

    IF v_same_level THEN
      v_msg := '꽤 어려운 어휘를 알고 있네요. (다른 회차에서 만나요)';
    ELSIF p_level = '초등' AND v_in_middle THEN
      v_msg := '꽤 어려운 어휘를 알고 있네요. (중등 과정에서 만나요)';
    ELSE
      v_msg := '꽤 어려운 어휘를 알고 있네요. 훌륭해요!';
    END IF;

    RETURN jsonb_build_object(
      'result', 'correct',
      'message', v_msg,
      'word', v_match_in_curriculum.word, 'hanja', v_match_in_curriculum.hanja
    );
  END IF;

  SELECT dl.* INTO v_match
  FROM dict_lookup dl
  WHERE dl.word = p_word AND dl.word_type = 1 AND dl.hanja LIKE '%' || p_main_char || '%'
  ORDER BY dl.source ASC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'result', 'hanja_with_main',
      'message', '어려운 어휘를 알고 있네요! 훌륭해요!',   -- 사전에만 있는 어휘 — 어느 회차에도 안 나옴
      'word_type', v_match.word_type, 'word', v_match.word, 'hanja', v_match.hanja
    );
  END IF;

  -- 主字와 훈이 같은 다른 한자로 된 어휘 (예: 아니 불(不) 회차의 '부인' = 아닐 부(否)) — 2026-10-15
  v_same := wordsense_same_hun_hint(p_word, p_main_char);
  IF v_same IS NOT NULL THEN
    RETURN v_same;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'word', dl.word, 'hanja', dl.hanja, 'word_type', dl.word_type,
    'composition', dl.composition, 'source', dl.source
  ) ORDER BY dl.source ASC, dl.word_type ASC)
  INTO v_matches FROM dict_lookup dl WHERE dl.word = p_word;

  IF v_matches IS NOT NULL AND jsonb_array_length(v_matches) > 0 THEN
    SELECT dl.* INTO v_match FROM dict_lookup dl
    WHERE dl.word = p_word ORDER BY dl.source ASC, dl.word_type ASC LIMIT 1;

    IF v_match.word_type = 1 THEN
      v_result := 'hanja_word'; v_msg := '어려운 한자어를 알고 있네요. 훌륭해요!';
    ELSIF v_match.word_type = 2 THEN
      v_result := 'native'; v_msg := '이건 순우리말이에요!';
    ELSIF v_match.word_type = 3 THEN
      v_result := 'foreign'; v_msg := '이건 외래어랍니다!';
    ELSIF v_match.word_type = 4 THEN
      v_result := 'hybrid';
      IF    v_match.composition = 'NH' THEN v_msg := '우리말+한자로 이루어진 어휘예요.';
      ELSIF v_match.composition = 'HN' THEN v_msg := '한자+우리말로 이루어진 어휘예요.';
      ELSIF v_match.composition = 'FH' THEN v_msg := '외래어+한자로 이루어진 어휘예요.';
      ELSIF v_match.composition = 'HF' THEN v_msg := '한자+외래어로 이루어진 어휘예요.';
      ELSIF v_match.composition = 'NF' THEN v_msg := '우리말+외래어로 이루어진 어휘예요.';
      ELSIF v_match.composition = 'FN' THEN v_msg := '외래어+우리말로 이루어진 어휘예요.';
      ELSE v_msg := '여러 어종이 합쳐진 단어예요.';
      END IF;
    ELSE
      v_result := 'unknown_type'; v_msg := '분류되지 않은 어휘예요.';
    END IF;
    RETURN jsonb_build_object(
      'result', v_result, 'message', v_msg,
      'word_type', v_match.word_type, 'composition', v_match.composition, 'matched', v_matches
    );
  END IF;

  -- 어근(혼자 안 쓰이는 말) — 예: 생생 → 생생하다·생생히
  SELECT r.* INTO v_root FROM dict_root r WHERE r.word = p_word;
  IF FOUND THEN
    IF ((ascii(substr(p_word, length(p_word), 1)) - 44032) % 28) > 0 THEN v_topic := '은'; ELSE v_topic := '는'; END IF;
    RETURN jsonb_build_object(
      'result',  'root',
      'message', '''' || p_word || '''' || v_topic || ' 혼자서는 쓰이지 않고 '
                 || (SELECT string_agg('''' || f || '''', ', ') FROM unnest(v_root.forms[1:2]) AS f)
                 || '처럼 써요.',
      'forms',   to_jsonb(v_root.forms), 'hanja', v_root.hanja
    );
  END IF;

  RETURN jsonb_build_object(
    'result',  'not_found',
    'message', '표준국어대사전에 등록된 어휘가 아니에요.'
  );
END;
$function$;
