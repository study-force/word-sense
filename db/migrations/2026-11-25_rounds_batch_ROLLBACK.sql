-- 2026-11-25_rounds_batch.sql 되돌리기
--   Edge Function wordsense-progress 는 이 함수가 없으면 예전 방식(학생 한 명씩)으로 답하므로,
--   함수를 지워도 마이룸 회차별 현황은 계속 나옴(새 칸·실력 점검 줄은 빠지고, 여러 학생 한 번에 조회는 503 'batch_unavailable'로 답함).
DROP FUNCTION IF EXISTS public.wordsense_rounds_batch(jsonb);
-- 색인은 남겨 두어도 해가 없음. 꼭 지워야 하면:
-- DROP INDEX IF EXISTS public.idx_session_init_user_no;
