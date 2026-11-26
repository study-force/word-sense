-- ════════════════════════════════════════════════════════════════
-- 센터 완료 통보 실패 기록 (2026-11-26)
--   wordsense-complete 가 게이트(service-back) 완료 API 를 재시도해도 끝내 실패한 회차를 남겨 두는 표.
--   「실패분 다시 보내기」(wordsense-complete 의 action:'resend_failed')가 이 표의 풀리지 않은 줄을 다시 보낸다.
--   설명: docs/완료통보_재시도_알림_20261126.md
--
--   kind
--     complete_failed       센터에 완료가 남지 않음 → 다시 보내기 대상
--     training_end_failed   회차는 저장됐으나 구 센터의 무료·추가 회차 처리가 실패 → 센터에서 손으로 처리(다시 보내도 「이미 처리된」만 온다)
--     training_end_unknown  답을 못 받은 시도가 실제로는 저장돼 있었음 → 무료·추가 회차 처리 결과를 모름(보통 등급 알림, 확인 뒤 풀림 표시)
--
--   알림이 못 간 줄(alerted_at 이 비고 5분 넘음)은 함수가 요청을 받을 때마다 훑어서 알린다 — 예약 작업(pg_cron)은 쓰지 않는다
--   (이 프로젝트는 pg_cron·pg_net 이 꺼져 있다. 이유는 문서 2번).
--
--   개인정보는 넣지 않는다(회원 번호·학원 번호·회차·게이트 응답뿐). study_token 은 복사하지 않고 다시 보낼 때 session_init 에서 읽는다.
--   함수는 이 표가 없어도 돈다(기록·다시 보내기만 빠진다) → 함수보다 먼저 올리든 나중에 올리든 훈련 저장에는 영향 없음.
-- 적용 순서: 테스트 DB → 검증 → 운영 DB
-- 되돌리기: 2026-11-26_complete_retry_ROLLBACK.sql
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS complete_failures (
  id               BIGSERIAL    PRIMARY KEY,
  kind             TEXT         NOT NULL DEFAULT 'complete_failed'
                   CHECK (kind IN ('complete_failed', 'training_end_failed', 'training_end_unknown')),
  session_init_id  UUID,                       -- 입장권(session_init.id). 입장권 없는 구버전 호출은 기록하지 않는다
  attempt_id       BIGINT,                     -- attempts.id (있으면)
  member_no        BIGINT,                     -- 회원 번호
  academy_no       BIGINT,                     -- 학원 번호
  payment_fn       TEXT         NOT NULL,
  training_round   INT          NOT NULL,
  last_status      INT,                        -- 마지막 게이트 HTTP 상태 (0 = 통신 오류·시간 초과)
  last_message     TEXT,
  tries            INT          NOT NULL DEFAULT 1,   -- 지금까지 시도한 횟수(다시 보내기 포함)
  first_failed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_tried_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  alerted_at       TIMESTAMPTZ,                -- 더큰웍스 운영 알림 창구가 받은 시각(묶여서 생략된 경우 포함). NULL = 알림 못 보냄
  resolved_at      TIMESTAMPTZ,                -- 풀린 시각. NULL = 아직 안 풀림
  resolved_how     TEXT                        -- sent(다시 보내 성공) / already(센터에 이미 완료) / already_completed / manual(손으로 처리)
);
COMMENT ON TABLE complete_failures IS '센터 완료 통보 실패 기록 — wordsense-complete 가 쓰고, 다시 보내기(action resend_failed)가 읽는다';

-- 같은 입장권·같은 종류의 풀리지 않은 줄은 하나만
CREATE UNIQUE INDEX IF NOT EXISTS uq_complete_failures_open
  ON complete_failures (session_init_id, kind) WHERE resolved_at IS NULL AND session_init_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_complete_failures_open
  ON complete_failures (kind, id) WHERE resolved_at IS NULL;
-- 훑기(알림이 못 간 줄 찾기)용 — 평소에는 거의 빈 색인
CREATE INDEX IF NOT EXISTS idx_complete_failures_unalerted
  ON complete_failures (last_tried_at) WHERE resolved_at IS NULL AND alerted_at IS NULL;

-- 권한: Edge Function(service_role)만. 익명·로그인 사용자는 접근 불가(정책 없음)
ALTER TABLE complete_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON complete_failures FROM anon, authenticated;
REVOKE ALL ON SEQUENCE complete_failures_id_seq FROM anon, authenticated;

-- 확인
SELECT kind, count(*) FILTER (WHERE resolved_at IS NULL) AS 안풀림, count(*) AS 전체
FROM complete_failures GROUP BY kind;
