-- 해요체 표기 보정 (後·開) — 2026-10-09
--   대괄호 머리 [훈- 음.] 누락/오타만 교정. 낭독되는 산문은 그대로 → 초등 오디오 무영향.
--   子는 산문 자체가 격식체(낭독 영향) → 이번 보류.
--   백업 → UPDATE → admin_change_log 기록(관리자 편집과 동일한 감사 로그), 전부 트랜잭션.
\set ON_ERROR_STOP on
\pset pager off
BEGIN;

-- 1) 백업 (後·開 변경 전 행)
CREATE TABLE main_chars_haeyo_bak_20261009 AS
SELECT * FROM main_chars WHERE char IN ('後','開');
SELECT count(*) AS "① 백업건수(=2 기대)" FROM main_chars_haeyo_bak_20261009;

-- 2) UPDATE (전체 문자열 명시, 달러 인용)
UPDATE main_chars SET etymology =
$q$[뒤- 후.] 는 '발이 끈에 묶여 뒤로 처져 따라가는 모습' 이에요. [뒤], [뒤쪽]에서 출발해 [나중], [자손], [후예.] 까지 의미가 넓어졌어요.$q$,
  updated_at=now() WHERE char='後';

UPDATE main_chars SET etymology =
$q$[열- 개.] 는 '두 손으로 문의 빗장을 열어젖히는 모양' 이에요. [열다]에서 출발해, [시작하다], [깨우치다], [발전시키다.] 까지 의미가 넓어졌어요.$q$,
  updated_at=now() WHERE char='開';

-- 3) 변경이력 (before=백업, after=현재) — 관리자 로그 형식과 동일한 5필드
INSERT INTO admin_change_log (system, entity, entity_id, before_data, after_data, note)
SELECT 'word-sense', 'main_chars', b.char,
  jsonb_build_object('char',b.char,'char_hangul',b.char_hangul,'eum',b.eum,'etymology',b.etymology,'meanings',b.meanings),
  jsonb_build_object('char',m.char,'char_hangul',m.char_hangul,'eum',m.eum,'etymology',m.etymology,'meanings',m.meanings),
  '격식체 표기 보정(대괄호 머리): 낭독 산문 불변, 초등 오디오 무영향'
FROM main_chars_haeyo_bak_20261009 b JOIN main_chars m ON m.char=b.char
ORDER BY b.char;

-- 4) 검증
SELECT char, etymology FROM main_chars WHERE char IN ('後','開') ORDER BY char;
SELECT
  (SELECT count(*) FROM main_chars WHERE char IN ('後','開') AND etymology LIKE '[%') AS "② 後開 해요체머리(=2 기대)",
  (SELECT count(*) FROM main_chars WHERE char='子' AND etymology NOT LIKE '[%') AS "③ 子 격식체 유지(=1 기대)",
  (SELECT count(*) FROM main_chars WHERE etymology IS NULL OR etymology NOT LIKE '[%') AS "④ 남은 격식체(=1 기대: 子만)";

COMMIT;
