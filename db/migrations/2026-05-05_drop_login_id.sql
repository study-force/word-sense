-- ════════════════════════════════════════════════════════════════
-- 마이그레이션: login_id 컬럼 제거
-- Date: 2026-05-05
-- 사유: login_id는 Supabase 측에서 사용처 없음 (랭킹·진행도·RLS 모두 member_no로 충분)
--      개인정보 최소 수집 원칙에 따라 제거
--
-- 적용:
--   Supabase Studio → SQL Editor → 이 파일 RUN
-- ════════════════════════════════════════════════════════════════

-- 1. 인덱스 제거
DROP INDEX IF EXISTS idx_profile_cache_login_id;

-- 2. 컬럼 제거
ALTER TABLE user_profile_cache DROP COLUMN IF EXISTS login_id;

-- 3. 확인
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'user_profile_cache'
ORDER BY ordinal_position;
