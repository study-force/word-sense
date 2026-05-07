-- ════════════════════════════════════════════════════════════════
-- Migration: classify_word_input v3 — '다른 회차 가족 어휘' 메시지
-- Date: 2026-05-07
--
-- 변경:
--   • "'기생'을 찾았어요!" (correct) → "꽤 어려운 어휘를 알고 있네요. (다른 회차에서 만나요)"
--
-- 배경:
--   classify_word_input은 프론트의 step 6 (WORD_MAP·WRONG_MAP 매칭 실패)에서만 호출됨.
--   따라서 RPC가 'correct'를 반환하는 경우 = 다른 회차의 가족 어휘 (현 회차 WORD_MAP엔 없음).
--   단순 정답 메시지 대신, 칭찬+안내 메시지로 변경하여 학습 메커니즘 명확히 구분.
--   점수 카운트는 프론트에서 차단 (이 함수는 메시지만 반환).
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
  -- 0. 입력 정제
  p_word := COALESCE(TRIM(p_word), '');
  p_main_char := COALESCE(TRIM(p_main_char), '');

  IF p_word = '' OR p_main_char = '' THEN
    RETURN jsonb_build_object(
      'result',  'invalid_input',
      'message', '입력이 비어 있어요.'
    );
  END IF;

  -- 한국어 받침 자동 판정 (을/를) — 다른 케이스에서 사용 가능하게 유지
  IF length(p_word) > 0 AND
     ascii(substr(p_word, length(p_word), 1)) BETWEEN 44032 AND 55203 AND
     ((ascii(substr(p_word, length(p_word), 1)) - 44032) % 28) > 0
  THEN
    v_particle := '을';
  ELSE
    v_particle := '를';
  END IF;

  -- 1단계: 출제 범위(word_master)에서 主字 포함 어휘 → 다른 회차 가족 어휘로 인정
  SELECT wm.* INTO v_match_in_curriculum
  FROM word_master wm
  WHERE wm.word = p_word
    AND (wm.char1 = p_main_char OR wm.char2 = p_main_char)
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'result',  'correct',
      'message', '꽤 어려운 어휘를 알고 있네요. (다른 회차에서 만나요)',
      'word',    v_match_in_curriculum.word,
      'hanja',   v_match_in_curriculum.hanja
    );
  END IF;

  -- 2단계: dict_lookup에서 主字 포함 한자어 → 출제 범위 밖이지만 칭찬
  SELECT dl.* INTO v_match
  FROM dict_lookup dl
  WHERE dl.word = p_word
    AND dl.word_type = 1
    AND dl.hanja LIKE '%' || p_main_char || '%'
  ORDER BY dl.source ASC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'result',    'hanja_with_main',
      'message',   '정답이에요! 어려운 어휘인데 훌륭해요!',
      'word_type', v_match.word_type,
      'word',      v_match.word,
      'hanja',     v_match.hanja
    );
  END IF;

  -- 3단계: dict_lookup 일반 매칭 (어종별)
  SELECT jsonb_agg(jsonb_build_object(
    'word',        dl.word,
    'hanja',       dl.hanja,
    'word_type',   dl.word_type,
    'composition', dl.composition,
    'source',      dl.source
  ) ORDER BY dl.source ASC, dl.word_type ASC)
  INTO v_matches
  FROM dict_lookup dl
  WHERE dl.word = p_word;

  IF v_matches IS NOT NULL AND jsonb_array_length(v_matches) > 0 THEN
    SELECT dl.* INTO v_match
    FROM dict_lookup dl
    WHERE dl.word = p_word
    ORDER BY dl.source ASC, dl.word_type ASC
    LIMIT 1;

    IF v_match.word_type = 1 THEN
      v_result := 'hanja_word';
      v_msg    := '어려운 한자어를 알고 있네요. 훌륭해요!';
    ELSIF v_match.word_type = 2 THEN
      v_result := 'native';
      v_msg    := '이건 순우리말이에요!';
    ELSIF v_match.word_type = 3 THEN
      v_result := 'foreign';
      v_msg    := '이건 외래어랍니다!';
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
      v_result := 'unknown_type';
      v_msg    := '분류되지 않은 어휘예요.';
    END IF;

    RETURN jsonb_build_object(
      'result',      v_result,
      'message',     v_msg,
      'word_type',   v_match.word_type,
      'composition', v_match.composition,
      'matched',     v_matches
    );
  END IF;

  -- 4단계: 어디에도 없음
  RETURN jsonb_build_object(
    'result',  'not_found',
    'message', '등록된 단어가 아니에요.'
  );
END;
$$;

-- 검증
SELECT
  classify_word_input('학교', '校') AS test_other_round_word,
  classify_word_input('대왕', '生') AS test_hanja_no_main,
  classify_word_input('동네', '生') AS test_hybrid_HN,
  classify_word_input('피자', '生') AS test_foreign,
  classify_word_input('아침', '生') AS test_native;
