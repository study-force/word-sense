-- ════════════════════════════════════════════════════════════════
-- 콘텐츠 테이블 초기화 (areas는 유지)
--
-- 이전 placeholder 데이터(data.js 시드, session1 샘플 등)를 모두 청소.
-- 마이그레이션(migration_test.sql) 직전에 실행 권장.
--
-- ⚠️ 학습 기록 테이블(Phase 2)이 추가된 후에는 이 스크립트가 학습 기록도
--    함께 날릴 수 있으니, Phase 2 이후엔 사용하지 말 것.
-- ════════════════════════════════════════════════════════════════

-- TRUNCATE CASCADE — 자식 테이블도 함께 비움 (session_words, wrong_words)
TRUNCATE TABLE word_master, sessions RESTART IDENTITY CASCADE;

-- 검증 — 모두 0행이어야 정상
SELECT
  (SELECT COUNT(*) FROM areas)         AS areas_kept,
  (SELECT COUNT(*) FROM sessions)      AS sessions_cleared,
  (SELECT COUNT(*) FROM word_master)   AS word_master_cleared,
  (SELECT COUNT(*) FROM session_words) AS session_words_cleared,
  (SELECT COUNT(*) FROM wrong_words)   AS wrong_words_cleared;
-- 기대: areas=6, 나머지 모두 0
