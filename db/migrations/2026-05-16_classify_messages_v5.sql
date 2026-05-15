-- ════════════════════════════════════════════════════════════════
-- Migration: classify_word_input v5 — hanja_with_main 메시지 톤 변경
-- Date: 2026-05-16
--
-- 변경:
--   • hanja_with_main:
--     "정답이에요! 어려운 어휘인데 훌륭해요!"
--     → "어려운 어휘를 알고 있네요! 다른 회차에서 만나요~"
--     (correct 톤과 일관성 강화 — 主字 포함 한자어도 다른 회차에서 다시 만날 수 있음을 안내)
--
-- 적용:
--   Supabase Studio → SQL Editor → 이 파일 RUN
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION classify_word_input(p_word TEXT, p_main_char TEXT)
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
BEGIN
  p_word := COALESCE(TRIM(p_word), '');
  p_main_char := COALESCE(TRIM(p_main_char), '');
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
    RETURN jsonb_build_object(
      'result', 'correct',
      'message', '꽤 어려운 어휘를 알고 있네요. (다른 회차에서 만나요)',
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
      'message', '어려운 어휘를 알고 있네요! 다른 회차에서 만나요~',
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
      IF    v_match.composition = 'NH' THEN v_msg := '우리말+한자로 이루어진 어휘에요.';
      ELSIF v_match.composition = 'HN' THEN v_msg := '한자+우리말로 이루어진 어휘에요.';
      ELSIF v_match.composition = 'FH' THEN v_msg := '외래어+한자로 이루어진 어휘에요.';
      ELSIF v_match.composition = 'HF' THEN v_msg := '한자+외래어로 이루어진 어휘에요.';
      ELSIF v_match.composition = 'NF' THEN v_msg := '우리말+외래어로 이루어진 어휘에요.';
      ELSIF v_match.composition = 'FN' THEN v_msg := '외래어+우리말로 이루어진 어휘에요.';
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

  -- 4단계: 사전에 없음
  RETURN jsonb_build_object(
    'result',  'not_found',
    'message', '표준국어대사전에 등록된 어휘가 아니에요.'
  );
END;
$$;

-- 적용 확인 — 主字 포함 한자어 입력 시 새 메시지 반환되는지 검증
-- (生 회차 기준 — 사용자가 입력해 본 한자어로 바꿔 테스트 가능)
SELECT classify_word_input('생활', '生') AS test_hanja_with_main_v5;
