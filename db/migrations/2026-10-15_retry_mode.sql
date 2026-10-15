-- ════════════════════════════════════════════════════════════════
-- 재훈련(retry) 모드 (대표님 결정 2026-10-15)
--   · 학원 사이트에서 회차별 "다시 하기"로 진입 — wordsense-start 에 training_mode: "retry"
--   · 재훈련은 학원 완료 API를 부르지 않음(학원 횟수·기록 불변), Supabase에만 is_retry=true 로 저장
--   · 재훈련이 끝나면 '내일의 한자' 없이 종료, 순위 집계에는 포함(대표님 결정)
-- 적용 순서: 테스트 DB → 검증 → 운영 DB
-- ════════════════════════════════════════════════════════════════

ALTER TABLE session_init ADD COLUMN IF NOT EXISTS training_mode TEXT NOT NULL DEFAULT 'normal';   -- normal | retry
ALTER TABLE attempts     ADD COLUMN IF NOT EXISTS is_retry      BOOLEAN NOT NULL DEFAULT false;
