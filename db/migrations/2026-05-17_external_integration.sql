-- ════════════════════════════════════════════════════════════════
-- Migration: 외부 연동 (구서버 ↔ 신규 한자 훈감각 익히기)
-- Date: 2026-05-17
--
-- 목적:
--   구서버(sfcenter.co.kr)에서 학생/회차/결제 정보 받아 학습 시작.
--   학습 결과는 신규(Supabase)에 자세히 저장.
--   완료 시 구서버 sf_study_hanja API로 콜백 (멱등성).
--
-- 4개 테이블 추가:
--   1) students       : 학생 캐시 (구서버 마스터, 우리는 캐시)
--   2) academies      : 학원 캐시
--   3) session_init   : 진입 → 학습 시작 사이 임시 세션 (TTL 10분)
--   4) service_back_token : service-back JWT 영구 캐시 (만료 없음)
--
-- 적용:
--   Supabase Studio → SQL Editor → 이 파일 RUN
-- ════════════════════════════════════════════════════════════════

-- ── 1) 학생 캐시 ──
CREATE TABLE IF NOT EXISTS students (
  user_no       BIGINT       PRIMARY KEY,
  name          TEXT         NOT NULL,
  section       TEXT,         -- 초등/중등/고등/초등(고)/N수생/일반
  school_grade  INT,
  academy_no    BIGINT,
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ  DEFAULT NOW()
);
COMMENT ON TABLE students IS '학생 캐시 — 마스터는 구서버, 진입 시 upsert';

-- ── 2) 학원 캐시 ──
CREATE TABLE IF NOT EXISTS academies (
  academy_no    BIGINT       PRIMARY KEY,
  name          TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);
COMMENT ON TABLE academies IS '학원 캐시 — 마스터는 구서버, 진입 시 upsert';

-- ── 3) 진입 세션 (구서버 POST → 학생 브라우저 사이 짧은 다리) ──
CREATE TABLE IF NOT EXISTS session_init (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_no         BIGINT       NOT NULL,
  payment_fn      TEXT         NOT NULL,
  training_round  INT          NOT NULL,
  is_payment      TEXT         NOT NULL,    -- 'Y' / 'N'
  academy_no      BIGINT,
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  expires_at      TIMESTAMPTZ  DEFAULT (NOW() + INTERVAL '10 minutes'),
  used_at         TIMESTAMPTZ              -- 1회 사용 후 마크
);
COMMENT ON TABLE session_init IS '진입 임시 세션 (10분 TTL) — wordsense-start가 INSERT, wordsense-session이 READ + used_at SET';

-- 만료된 세션 자동 정리 (선택) — 일 1회 cron으로 삭제
CREATE INDEX IF NOT EXISTS idx_session_init_expires ON session_init (expires_at);

-- ── 4) service-back JWT 영구 캐시 ──
CREATE TABLE IF NOT EXISTS service_back_token (
  id           TEXT         PRIMARY KEY DEFAULT 'singleton',
  token        TEXT         NOT NULL,
  issued_at    TIMESTAMPTZ  DEFAULT NOW()
);
COMMENT ON TABLE service_back_token IS 'service-back JWT 캐시 (만료 없음). wordsense-complete가 발급/조회.';

-- ── 권한: 익명(anon)/인증(authenticated) 접근 차단. Edge Function만 service_role로 접근 ──
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE academies ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_init ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_back_token ENABLE ROW LEVEL SECURITY;

-- (필요 시) anon 읽기 정책 추가 가능. 기본은 차단.
