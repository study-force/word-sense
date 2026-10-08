-- ════════════════════════════════════════════════════════════════
-- Migration: 학제(level) 구분 추가 — 초등/중등 콘텐츠 공존
-- Date: 2026-10-08
--
-- 변경:
--   • sessions.level 컬럼 추가 (기존 300회차는 '초등'으로 태그)
--   • UNIQUE(area_id, round_no) → UNIQUE(area_id, round_no, level)
--     → 초등 생물1(生)과 중등 생물1(大)이 충돌 없이 공존
--
-- 적용: psql -f (PGCLIENTENCODING=UTF8). idempotent.
-- ════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT '초등';

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_area_id_round_no_key;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_area_round_level_key;
ALTER TABLE sessions ADD CONSTRAINT sessions_area_round_level_key UNIQUE (area_id, round_no, level);

-- word_master 등급 체크 1~4 → 1~5 (중등 5등급 어휘 허용)
ALTER TABLE word_master DROP CONSTRAINT IF EXISTS word_master_grade_check;
ALTER TABLE word_master ADD CONSTRAINT word_master_grade_check CHECK (grade BETWEEN 1 AND 5);

COMMIT;

-- 검증
SELECT level, COUNT(*) FROM sessions GROUP BY level;
