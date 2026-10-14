-- ════════════════════════════════════════════════════════════════
-- Migration: classify_word_input v7 — 어근(dict_root) 안내 추가 (v6 + 어근 단계)
-- Date: 2026-10-14
--   사전(명사)에 없을 때, 어근이면: "'생생'은 혼자서는 쓰이지 않고 '생생하다', '생생히'처럼 써요."
-- ════════════════════════════════════════════════════════════════

BEGIN;


CREATE OR REPLACE FUNCTION classify_word_input(p_word TEXT, p_main_char TEXT, p_level TEXT DEFAULT '초등')
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
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
  IF FOUND THEN
    -- 이 학생이 실제로 만날 수 있는 회차에 나오는지 (같은 낱말·主字 포함 entry 전부 기준)
    SELECT EXISTS (
      SELECT 1
      FROM word_master wm
      JOIN session_words sw ON sw.word_master_id = wm.id
      JOIN sessions s ON s.id = sw.session_id
      WHERE wm.word = p_word AND (wm.char1 = p_main_char OR wm.char2 = p_main_char)
        AND ( s.level = p_level
              OR (p_level = '중등' AND s.level = '초등'
                  AND s.main_char IN (SELECT main_char FROM sessions WHERE level = '중등')) )
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
$$;

GRANT EXECUTE ON FUNCTION classify_word_input(TEXT, TEXT, TEXT) TO anon, authenticated;

COMMIT;
