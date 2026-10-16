-- 회차 테스트 '다시 훈련' 탭: 못 익힌 어휘가 남은 회차를 빨갛게 (대표님 2026-10-16)
--   훈련 앱(테스트 접속) 결과 화면이 어드민 테스트 화면에 '내 어휘 N / 전체 T'를 보내고, 어드민이 여기에 기록
--   어드민 전용 표(콘텐츠 아님) — 운영 DB(sf-admin lib/db.js)
ALTER TABLE public.admin_test_log ADD COLUMN IF NOT EXISTS known_count INT;
ALTER TABLE public.admin_test_log ADD COLUMN IF NOT EXISTS total_words INT;
ALTER TABLE public.admin_test_log ADD COLUMN IF NOT EXISTS known_at TIMESTAMPTZ;
