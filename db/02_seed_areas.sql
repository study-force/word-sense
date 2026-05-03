-- ════════════════════════════════════════════════════════════════
-- 영역(areas) 시드 데이터 — 6개 영역 고정
-- 01_content_schema.sql 이후에 실행
-- ════════════════════════════════════════════════════════════════

INSERT INTO areas (slug, name_ko, emoji, display_order) VALUES
  ('biology', '생물', '🌿', 1),
  ('society', '사회', '⚖️', 2),
  ('history', '역사', '📜', 3),
  ('science', '과학', '🔬', 4),
  ('culture', '문화', '🎭', 5),
  ('economy', '경제', '💰', 6);

-- 확인
SELECT id, slug, name_ko, emoji, display_order FROM areas ORDER BY display_order;
