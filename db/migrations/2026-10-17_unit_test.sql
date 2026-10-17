-- 단원평가 응시 기록 (기획 v7, 대표님 2026-10-17)
--   5회차 단원마다 25문항 · 한글만 정답 4점 / 한자 보고 풀어 정답 2점 · 100점 만점
--   시작 때 25문항을 test_answers에 미리 만들어 두고 답할 때마다 채움 → 중간에 나가도 같은 문제로 이어 하기
--   학생 기록이라 '실서버에 반영'(콘텐츠 복사) 대상 아님. RLS: 정책 없음 = service_role(Edge wordsense-unittest)만
CREATE TABLE IF NOT EXISTS public.test_attempts (
  id              bigserial PRIMARY KEY,
  member_no       bigint NOT NULL,
  level           text   NOT NULL,                 -- 초등 | 중등
  area_id         bigint NOT NULL REFERENCES public.areas(id),
  unit            int    NOT NULL,                 -- 1~10 (5회차 단위)
  round_from      int    NOT NULL,
  round_to        int    NOT NULL,
  status          text   NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'done')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  duration_ms     int    NOT NULL DEFAULT 0,       -- 실제로 문제를 푼 시간 합
  n_known         int,                             -- 바로 앎 (4점)
  n_hanja         int,                             -- 한자로 풂 (2점)
  n_hanja_wrong   int,                             -- 한자 보고도 틀림
  n_wrong         int,                             -- 틀림 (한자 없이 오답)
  score           int,                             -- 100점 만점
  session_init_id uuid
);
-- 한 학생·단원에 '진행 중'은 하나만 (이어 하기)
CREATE UNIQUE INDEX IF NOT EXISTS test_attempts_one_open
  ON public.test_attempts (member_no, level, area_id, unit) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS test_attempts_member ON public.test_attempts (member_no, level, area_id);

CREATE TABLE IF NOT EXISTS public.test_answers (
  attempt_id      bigint NOT NULL REFERENCES public.test_attempts(id) ON DELETE CASCADE,
  ord             int    NOT NULL,                 -- 1~25 출제 순서
  session_word_id bigint NOT NULL,
  word_master_id  bigint NOT NULL,
  round_no        int    NOT NULL,
  grade           int,                             -- 국립국어원 기초 어휘 등급 (누적 급수별 결과용)
  word            text   NOT NULL,
  hanja           text,
  hun             text,                            -- 한자 보고 풀기 때 보여 준 훈음 (예: 體 몸 체 · 溫 따뜻할 온)
  choices         jsonb  NOT NULL,                 -- 보기 4개 뜻 (출제 순서 그대로 고정)
  correct_idx     int    NOT NULL,
  hanja_used      boolean NOT NULL DEFAULT false,  -- '한자 보고 풀기'를 눌렀는지 (누르는 순간 저장)
  choice_idx      int,
  result          text CHECK (result IN ('known', 'hanja', 'hanja_wrong', 'wrong')),
  ms              int,
  answered_at     timestamptz,
  PRIMARY KEY (attempt_id, ord)
);

ALTER TABLE public.test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_answers  ENABLE ROW LEVEL SECURITY;
