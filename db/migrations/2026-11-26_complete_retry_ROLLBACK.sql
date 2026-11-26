-- 2026-11-26_complete_retry.sql 되돌리기
--   Edge Function wordsense-complete 는 이 표가 없어도 돈다(재시도·알림은 그대로, 실패 기록과 「실패분 다시 보내기」만 빠진다 —
--   다시 보내기는 503 으로 답한다). 훈련 저장·센터 완료 통보에는 영향 없음.
--   ⚠ 지우기 전에 풀리지 않은 실패분이 남아 있는지 먼저 본다. 남아 있으면 다시 보내거나 따로 적어 둔 뒤 지운다.
SELECT kind, count(*) AS 안풀림 FROM complete_failures WHERE resolved_at IS NULL GROUP BY kind;

-- 위 결과를 확인한 뒤 아래 줄을 실행
-- DROP TABLE IF EXISTS public.complete_failures;
