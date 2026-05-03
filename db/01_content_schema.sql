-- ════════════════════════════════════════════════════════════════
-- 훈감각 익히기 — 콘텐츠 DB 스키마 (Phase 1)
-- DB: Supabase Postgres
-- Version: 1.0
-- Date: 2026-05-03
--
-- 적용 순서:
--   Supabase Studio → SQL Editor → 이 파일 전체 붙여넣고 RUN
-- ════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════
-- 1. areas (영역 — 고정 6행)
-- ════════════════════════════════════════
CREATE TABLE areas (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,        -- 'biology', 'society' 등 영문 키
  name_ko         TEXT NOT NULL,               -- '생물', '사회' 등 한글명
  emoji           TEXT,                        -- '🌿', '⚖️' 등 이모지
  display_order   SMALLINT NOT NULL DEFAULT 0, -- 정렬 순서
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE areas IS '학습 영역 — 생물/사회/역사/과학/문화/경제 (6행 고정)';


-- ════════════════════════════════════════
-- 2. sessions (회차 — 영역 × 50회차 = 300행)
-- ════════════════════════════════════════
CREATE TABLE sessions (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  area_id             BIGINT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  round_no            SMALLINT NOT NULL CHECK (round_no BETWEEN 1 AND 50),
  main_char           TEXT NOT NULL,           -- 主字 한자 1자 (예: '生')
  main_char_hangul    TEXT NOT NULL,           -- 훈+음 (예: '날 생')
  main_hun_short      TEXT,                    -- 훈만 (예: '날')
  main_eum            TEXT,                    -- 다의 라인 (예: '태어나다 · 살다 · 자라다')
  main_etymology      TEXT,                    -- 어원 풀이 (2~3문장)
  main_meanings       JSONB,                   -- 다의 카드 [{hun, examples[]}, ...] 가변 1~4개
  total_words         SMALLINT,                -- 가족 어휘 수 (캐시값, 트리거로 자동 갱신 가능)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (area_id, round_no)
);
COMMENT ON TABLE sessions IS '회차 — 영역×회차 = 300행. 主字와 어원·다의 카드 보유';
COMMENT ON COLUMN sessions.main_meanings IS 'JSONB 배열. 예: [{"hun":"나다·태어나다","examples":["출생","탄생"]}, ...]';


-- ════════════════════════════════════════
-- 3. word_master (어휘 마스터 — SSOT, 약 4,432행)
--   같은 어휘가 여러 회차에 등장해도 정답 풀이는 여기 한 곳에서만 관리
-- ════════════════════════════════════════
CREATE TABLE word_master (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  word          TEXT NOT NULL UNIQUE,          -- 한글 어휘 (예: '야생')
  hanja         TEXT NOT NULL,                 -- 한자 표기 (예: '野生')
  char1         TEXT NOT NULL,                 -- 첫 글자 한자 (예: '野')
  hun1          TEXT NOT NULL,                 -- 첫 글자 훈음 (예: '들 야')
  char2         TEXT NOT NULL,                 -- 둘째 글자 한자 (예: '生')
  hun2          TEXT NOT NULL,                 -- 둘째 글자 훈음 (예: '날 생')
  meaning       TEXT NOT NULL,                 -- 정답 풀이 (학습자 친화 정의, SSOT)
  grade         SMALLINT CHECK (grade BETWEEN 1 AND 4),  -- 어휘 등급 1~4
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE word_master IS '어휘 마스터 (SSOT) — meaning은 단일 출처. 회차별 등장은 session_words 참조';


-- ════════════════════════════════════════
-- 4. session_words (회차×어휘 등장 — 약 6,096행)
--   빈칸 문장과 4지선다는 회차마다 다르므로 여기 저장
-- ════════════════════════════════════════
CREATE TABLE session_words (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id        BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  word_master_id    BIGINT NOT NULL REFERENCES word_master(id) ON DELETE RESTRICT,
  fill_sentence     TEXT NOT NULL,             -- 빈칸 문장 ('___' 자리에 어휘 들어감)
  choices           JSONB NOT NULL,            -- 4지선다 [{text, is_correct}, ...]
  is_infer_quiz     BOOLEAN NOT NULL DEFAULT false,  -- 확장 전용(추론 어려운 어휘) 여부
  order_in_session  SMALLINT,                  -- 회차 내 어휘 순번 (시트 D열)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, word_master_id)
);
COMMENT ON TABLE session_words IS '회차×어휘 등장 — 빈칸문장과 4지선다는 회차별로 다름';
COMMENT ON COLUMN session_words.choices IS 'JSONB 배열. 예: [{"text":"들에서 자람","is_correct":true},{"text":"...","is_correct":false},...]';


-- ════════════════════════════════════════
-- 5. wrong_words (회차별 오답 입력 시 특수 피드백)
-- ════════════════════════════════════════
CREATE TABLE wrong_words (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  word        TEXT NOT NULL,                   -- 학생이 입력한 (가족 아닌) 어휘
  feedback    TEXT NOT NULL,                   -- 안내 메시지
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, word)
);
COMMENT ON TABLE wrong_words IS '회차별 오답 입력 시 특수 피드백 (예: 동음이의어 안내)';


-- ════════════════════════════════════════
-- 인덱스
-- ════════════════════════════════════════
CREATE INDEX idx_sessions_area_round    ON sessions (area_id, round_no);
CREATE INDEX idx_session_words_session  ON session_words (session_id, order_in_session);
CREATE INDEX idx_session_words_word     ON session_words (word_master_id);
CREATE INDEX idx_word_master_grade      ON word_master (grade);
CREATE INDEX idx_wrong_words_session    ON wrong_words (session_id);


-- ════════════════════════════════════════
-- updated_at 자동 갱신 trigger
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_word_master_updated_at
  BEFORE UPDATE ON word_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_session_words_updated_at
  BEFORE UPDATE ON session_words
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ════════════════════════════════════════
-- RLS (Row Level Security) — 콘텐츠는 누구나 읽기 가능
-- ════════════════════════════════════════
ALTER TABLE areas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE word_master   ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE wrong_words   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON areas         FOR SELECT USING (true);
CREATE POLICY "public_read" ON sessions      FOR SELECT USING (true);
CREATE POLICY "public_read" ON word_master   FOR SELECT USING (true);
CREATE POLICY "public_read" ON session_words FOR SELECT USING (true);
CREATE POLICY "public_read" ON wrong_words   FOR SELECT USING (true);

-- INSERT/UPDATE/DELETE는 service_role(백엔드)만 가능 → 정책 안 만들면 자동으로 막힘
-- Admin 작업은 Supabase Studio에서 직접 (대시보드 권한)


-- ════════════════════════════════════════
-- (선택) 편의 view — 회차 + 어휘 join 미리 묶어서 조회
-- ════════════════════════════════════════
CREATE OR REPLACE VIEW v_session_word_full AS
SELECT
  s.id          AS session_id,
  s.area_id,
  s.round_no,
  s.main_char,
  sw.id         AS session_word_id,
  sw.order_in_session,
  sw.fill_sentence,
  sw.choices,
  sw.is_infer_quiz,
  wm.id         AS word_master_id,
  wm.word,
  wm.hanja,
  wm.char1, wm.hun1,
  wm.char2, wm.hun2,
  wm.meaning,
  wm.grade
FROM sessions s
JOIN session_words sw ON sw.session_id = s.id
JOIN word_master wm   ON wm.id = sw.word_master_id;

COMMENT ON VIEW v_session_word_full IS '회차 + 어휘 통합 조회 — 앱 fetch 시 이 view 한 번만 호출하면 됨';


-- ════════════════════════════════════════
-- 끝.
-- ════════════════════════════════════════
