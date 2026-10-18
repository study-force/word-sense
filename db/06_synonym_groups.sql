-- ════════════════════════════════════════
-- 06. synonym_groups — 동의어/역순쌍 그룹 (선지 검증 근거)
--   규칙: 한 문항 선지 4개는 '공통 group_code'를 가지면 안 됨 (정답 포함).
--   한 어휘가 여러 그룹에 속할 수 있음(역순쌍 R과 완전동의어 G가 겹침: 분배 등).
--   권위 원천: 사전 엑셀 '동의어 그룹' 시트(G001~G128) + 확정 역순쌍 16종(R01~R16).
-- ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.synonym_groups (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_code      TEXT NOT NULL,                 -- 'G001'~ (완전동의어), 'R01'~ (역순쌍)
  word            TEXT NOT NULL,                 -- 한글 어휘
  hanja           TEXT NOT NULL DEFAULT '',      -- 한자 (NFKC·強→强 정규화 저장)
  word_master_id  BIGINT REFERENCES public.word_master(id) ON DELETE SET NULL,
  meaning         TEXT,                          -- 그룹 대표 뜻(참고)
  kind            TEXT NOT NULL DEFAULT 'synonym',  -- 'synonym'(완전동의어 G) | 'reverse'(역순쌍 R)
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_code, word, hanja)
);
CREATE INDEX IF NOT EXISTS ix_syn_group_code ON public.synonym_groups(group_code);
CREATE INDEX IF NOT EXISTS ix_syn_word       ON public.synonym_groups(word, hanja);
CREATE INDEX IF NOT EXISTS ix_syn_wmid       ON public.synonym_groups(word_master_id);
COMMENT ON TABLE public.synonym_groups IS '동의어/역순쌍 그룹 — 선지 검증 근거. 공통 group_code 공존 금지';
