-- 미사용 중복(고아) 변이행 정리 — 2026-10-09
--   대상: hanja != char1+char2 (이체자 변이 병기) AND 어느 세션에도 미사용(session_words 0)
--   확인: 73건 전부 '깨끗한 2글자 형제행' 존재 + word_results/session_words 참조 0
--   방식: 백업 테이블 생성 → 삭제 → 검증, 모두 한 트랜잭션. 오류 시 자동 롤백.
\set ON_ERROR_STOP on
\pset pager off
BEGIN;

-- 1) 백업 (삭제 대상 전체 행 보존 — 복구용)
CREATE TABLE word_master_orphan_bak_20261009 AS
SELECT w.*
FROM word_master w
LEFT JOIN (SELECT word_master_id, count(*) c FROM session_words GROUP BY 1) sw ON sw.word_master_id = w.id
WHERE w.hanja IS DISTINCT FROM (coalesce(w.char1,'') || coalesce(w.char2,''))
  AND coalesce(sw.c,0) = 0;

SELECT count(*) AS "① 백업건수(=73 기대)" FROM word_master_orphan_bak_20261009;

-- 2) 재확인 — 백업된 id 가 참조 테이블에 정말 0건인지 (방어)
SELECT
  (SELECT count(*) FROM session_words WHERE word_master_id IN (SELECT id FROM word_master_orphan_bak_20261009)) AS "② session_words(=0 기대)",
  (SELECT count(*) FROM word_results  WHERE word_master_id IN (SELECT id FROM word_master_orphan_bak_20261009)) AS "③ word_results(=0 기대)";

-- 3) 삭제 (백업에 담긴 id 만)
DELETE FROM word_master WHERE id IN (SELECT id FROM word_master_orphan_bak_20261009);

-- 4) 검증 — 남은 불일치(미사용) 0, word_master 총건수
SELECT
  (SELECT count(*) FROM word_master w
     LEFT JOIN (SELECT word_master_id, count(*) c FROM session_words GROUP BY 1) sw ON sw.word_master_id=w.id
     WHERE w.hanja IS DISTINCT FROM (coalesce(w.char1,'')||coalesce(w.char2,'')) AND coalesce(sw.c,0)=0) AS "④ 남은 미사용불일치(=0 기대)",
  (SELECT count(*) FROM word_master) AS "⑤ word_master 총건수";

COMMIT;
