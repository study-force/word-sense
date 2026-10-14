-- ════════════════════════════════════════════════════════════════
-- 학원 연동 v2 (성효민 대리 확정 사항, 2026-10-14~15)
--   · 진입: training_area(영역 slug)·study_token(1회용 훈련 토큰)·training_level(초등/중등, 선택) 추가
--   · 완료: service-back 호출 결과(training_end_success 등)와 학원 회차 정보를 Supabase 기록에 함께 저장
--     (Supabase = 훈련 상세 원장 — "훈련회차 정보도 포함해서 기록")
-- 적용 순서: 테스트 DB → 검증 → 운영 DB
-- ════════════════════════════════════════════════════════════════

ALTER TABLE session_init ADD COLUMN IF NOT EXISTS training_area  TEXT;
ALTER TABLE session_init ADD COLUMN IF NOT EXISTS training_level TEXT;
ALTER TABLE session_init ADD COLUMN IF NOT EXISTS study_token    TEXT;
ALTER TABLE session_init ADD COLUMN IF NOT EXISTS completed_at   TIMESTAMPTZ;   -- 완료 처리(학원 API 호출) 시각 — 중복 완료 방지

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS session_init_id       UUID;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS payment_fn            TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS training_round        INT;       -- 학원 시스템 회차
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS service_back_status   INT;       -- 학원 완료 API HTTP 상태
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS service_back_message  TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS training_end_success  BOOLEAN;   -- false면 학원 쪽 수기 처리 필요(무료/추가회차)
