-- ════════════════════════════════════════════════════════════════
-- 훈감각 익히기 — 사용자 입력 분류 시스템 (Phase 3)
-- DB: Supabase Postgres
-- Version: 1.0
-- Date: 2026-05-07
--
-- 목적:
--   학습자가 출제 범위(4,432) 외의 단어를 인출 단계에서 입력했을 때
--   적절한 분류 피드백을 제공하기 위한 룩업 테이블 + 분류 함수.
--
-- 데이터 소스:
--   • 표준국어대사전 (1차) — db/build_dict_lookup.js로 추출한 30,473행
--   • 우리말샘 (2차 폴백, 추후 추가)
--
-- 설계 원칙:
--   • in_curriculum 컬럼 없음 → word_master와 실시간 JOIN으로 항상 정확
--   • 출제 범위(word_master)가 변경돼도 자동 반영
--   • 분류 알고리즘은 RPC 함수로 등록 (Supabase REST 호출 1회)
--
-- 적용 순서:
--   1) 01~04 (Phase 1·2 모두 적용된 상태)
--   2) 05_dict_lookup_schema.sql ← 이 파일
--   3) 06_dict_lookup_load.sql   (CSV 적재 — 별도 파일)
-- ════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════
-- 1. dict_lookup (사전 룩업 테이블)
--   • 동음이의어는 별개 행 (PK = id, 보조 UNIQUE = word + hanja)
--   • 한자어·고유어·외래어·혼종어 4종 모두 보존
--   • 혼종어는 composition 컬럼에 조합 코드 (NH/HN/FH/HF/NF/FN/HH)
-- ════════════════════════════════════════
CREATE TABLE dict_lookup (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  word          TEXT NOT NULL,                                 -- 표제어 (한글 2자)
  hanja         TEXT NOT NULL DEFAULT '',                      -- 한자 표기 (한자어·혼종어만, 없으면 '')
  word_type     SMALLINT NOT NULL                              -- 어종
                CHECK (word_type IN (1, 2, 3, 4)),
  -- 1=한자어, 2=고유어, 3=외래어, 4=혼종어
  composition   TEXT NOT NULL DEFAULT '',                      -- 혼종어 조합 코드 (NH/HN/FH/HF/NF/FN/HH 등)
  source        SMALLINT NOT NULL DEFAULT 1                    -- 1=표준국어대사전, 2=우리말샘
                CHECK (source IN (1, 2)),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 동음이의어 보존: word + hanja 조합으로 중복 방지
  UNIQUE (word, hanja, source)
);

COMMENT ON TABLE  dict_lookup             IS '사전 룩업 — 사용자 입력 분류용 (표준국어대사전 + 우리말샘)';
COMMENT ON COLUMN dict_lookup.word_type   IS '어종: 1=한자어, 2=고유어, 3=외래어, 4=혼종어';
COMMENT ON COLUMN dict_lookup.composition IS '혼종어 조합 코드: NH(우리말+한자) / HN(한자+우리말) / FH(외래어+한자) / HF(한자+외래어) / NF / FN / HH';
COMMENT ON COLUMN dict_lookup.source      IS '데이터 출처: 1=표준국어대사전, 2=우리말샘';

-- 룩업 핵심 인덱스
CREATE INDEX idx_dict_lookup_word           ON dict_lookup (word);
CREATE INDEX idx_dict_lookup_word_hanja     ON dict_lookup (word, hanja);
CREATE INDEX idx_dict_lookup_word_type      ON dict_lookup (word_type);


-- ════════════════════════════════════════
-- 2. RLS — 사전은 누구나 읽기 가능
-- ════════════════════════════════════════
ALTER TABLE dict_lookup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON dict_lookup FOR SELECT USING (true);

-- INSERT/UPDATE/DELETE는 service_role(백엔드)만 가능 → 정책 안 만들면 자동 차단
-- 사전 데이터 갱신은 db/06_dict_lookup_load.sql 또는 Supabase Studio에서 직접


-- ════════════════════════════════════════
-- 3. classify_word_input — 입력 분류 함수 (RPC)
--   • 학습자가 인출 단계에서 입력한 단어를 분류
--   • 출제 범위는 word_master JOIN으로 실시간 매칭 (in_curriculum 컬럼 불필요)
--
-- 인자:
--   p_word      : 입력 단어 (한글 2자)
--   p_main_char : 회차 主字 (한자 1자)
--
-- 반환 (JSONB):
--   {
--     "result": "correct"|"family_no_main"|"hanja_word"|"native"|"foreign"|"hybrid"|"not_found",
--     "message": "사용자에게 표시할 메시지",
--     "word_type": 1|2|3|4|null,
--     "composition": "NH"|"HN"|... (혼종어만),
--     "matched": [{ word, hanja, word_type, composition }, ...]  -- 매칭된 사전 행들 (디버그용)
--   }
-- ════════════════════════════════════════
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

  -- 한국어 받침 자동 판정 (을/를)
  --   한글 음절 = 0xAC00 + 초성×588 + 중성×28 + 종성
  --   (codepoint - 0xAC00) % 28 = 0 이면 받침 없음 → '를'
  --                              > 0 이면 받침 있음 → '을'
  IF length(p_word) > 0 AND
     ascii(substr(p_word, length(p_word), 1)) BETWEEN 44032 AND 55203 AND
     ((ascii(substr(p_word, length(p_word), 1)) - 44032) % 28) > 0
  THEN
    v_particle := '을';
  ELSE
    v_particle := '를';
  END IF;

  -- 1단계: 출제 범위(word_master) 안에서 主字 포함 어휘 매칭 → 정답
  SELECT wm.* INTO v_match_in_curriculum
  FROM word_master wm
  WHERE wm.word = p_word
    AND (wm.char1 = p_main_char OR wm.char2 = p_main_char)
  LIMIT 1;

  IF FOUND THEN
    -- 호출 전제: 프론트의 step 6에서만 호출됨 → 현 회차 WORD_MAP 외 어휘
    -- 따라서 word_master 매칭 = 다른 회차 가족 어휘 (점수 카운트 안 됨)
    RETURN jsonb_build_object(
      'result',  'correct',
      'message', '꽤 어려운 어휘를 알고 있네요. (다른 회차에서 만나요)',
      'word',    v_match_in_curriculum.word,
      'hanja',   v_match_in_curriculum.hanja
    );
  END IF;

  -- 2단계: 표준국어대사전·우리말샘 매칭 (dict_lookup)
  --   먼저 主字 포함 한자어 우선 (정답 가능성)
  SELECT dl.* INTO v_match
  FROM dict_lookup dl
  WHERE dl.word = p_word
    AND dl.word_type = 1                      -- 한자어
    AND dl.hanja LIKE '%' || p_main_char || '%'
  ORDER BY dl.source ASC                       -- 표준국어대사전 우선
  LIMIT 1;

  IF FOUND THEN
    -- 출제 범위 밖이지만 主字 포함 한자어 → 칭찬형 피드백
    RETURN jsonb_build_object(
      'result',    'hanja_with_main',
      'message',   '정답이에요! 어려운 어휘인데 훌륭해요!',
      'word_type', v_match.word_type,
      'word',      v_match.word,
      'hanja',     v_match.hanja
    );
  END IF;

  -- 3단계: dict_lookup 아무 어휘나 (主字 없는 한자어, 고유어, 외래어, 혼종어)
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
    -- 첫 번째 매칭 (source 우선, word_type 우선)
    SELECT dl.* INTO v_match
    FROM dict_lookup dl
    WHERE dl.word = p_word
    ORDER BY dl.source ASC, dl.word_type ASC
    LIMIT 1;

    -- 어종별 메시지
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
      -- 혼종어 조합별 메시지
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
    'message', '표준국어대사전에 등록된 어휘가 아니에요.'
  );
END;
$$;

COMMENT ON FUNCTION classify_word_input IS '사용자 입력 분류 — 인출 단계 자유 입력에 대한 피드백 메시지 생성';

-- 익명 사용자도 RPC 호출 가능하게 (학생 인증 흐름 미연결 단계)
GRANT EXECUTE ON FUNCTION classify_word_input(TEXT, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════
-- 4. 진단 view — 출제 범위 vs 사전 커버리지
--   word_master(4,432) 중 dict_lookup에 있는·없는 어휘 확인용
-- ════════════════════════════════════════
CREATE OR REPLACE VIEW v_curriculum_dict_coverage AS
SELECT
  wm.word,
  wm.hanja                        AS curriculum_hanja,
  dl.hanja                        AS dict_hanja,
  dl.word_type,
  dl.composition,
  CASE WHEN dl.id IS NULL THEN false ELSE true END AS in_dict
FROM word_master wm
LEFT JOIN dict_lookup dl ON dl.word = wm.word
ORDER BY wm.word;

COMMENT ON VIEW v_curriculum_dict_coverage IS '출제 범위 어휘의 사전 커버리지 — in_dict=false인 어휘는 사전 등록 누락 (검수 대상)';


-- ════════════════════════════════════════
-- 끝.
-- 다음 단계:
--   • db/06_dict_lookup_load.sql  — CSV 적재 SQL (Supabase Studio Import 또는 COPY)
--   • word-sense.html 인출 입력 핸들러 → classify_word_input RPC 호출
-- ════════════════════════════════════════
