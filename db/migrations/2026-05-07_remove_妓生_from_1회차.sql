-- ════════════════════════════════════════════════════════════════
-- Migration: 1회차(생물)에서 妓生 제거
-- Date: 2026-05-07
--
-- 배경:
--   박차장님 검수본에 妓生(조선시대 기생, 사회·문화 영역)이 1회차(생물) 가족 어휘로
--   잘못 분류되어 등재됨. 1회차의 본래 가족 어휘 寄生(생물·기생)이 누락되어 있었고
--   별도 마이그레이션으로 寄生 추가됨.
--
--   현재 1회차 session_words에 妓生 + 寄生 두 행이 모두 있는데, WORD_MAP 키 충돌로
--   寄生만 게임에 노출되고 妓生은 회차 카운트만 부풀림. 1회차에서 妓生 제거.
--
-- 영향 범위:
--   • 1회차 session_words에서 妓生 행 1건 삭제
--   • word_master의 妓生 행은 유지 (다른 영역 추가·dict_lookup 보완용)
--   • 회차 어휘 카운트 정상화
-- ════════════════════════════════════════════════════════════════


-- 1회차 session_words에서 妓生 제거
DELETE FROM session_words sw
USING sessions s, areas a, word_master wm
WHERE sw.session_id = s.id
  AND s.area_id = a.id
  AND sw.word_master_id = wm.id
  AND a.slug = 'biology'
  AND s.round_no = 1
  AND wm.word = '기생' AND wm.hanja = '妓生';


-- ════════════════════════════════════════
-- 확인 — 1회차에 기생/寄生만 남았는지
-- ════════════════════════════════════════
SELECT s.round_no, sw.order_in_session, wm.word, wm.hanja, wm.meaning
FROM session_words sw
JOIN sessions s ON s.id = sw.session_id
JOIN areas a ON a.id = s.area_id
JOIN word_master wm ON wm.id = sw.word_master_id
WHERE a.slug = 'biology' AND s.round_no = 1 AND wm.word = '기생'
ORDER BY wm.hanja;

-- 1회차 전체 어휘 수 (정상화 확인)
SELECT s.round_no, COUNT(*) AS family_word_count
FROM session_words sw
JOIN sessions s ON s.id = sw.session_id
JOIN areas a ON a.id = s.area_id
WHERE a.slug = 'biology' AND s.round_no = 1
GROUP BY s.round_no;
