-- 빈칸(강화) 문제 오답 후보 적합도 — 골디락스 (2026-10-15)
--   context_session_id : 출제 회차 (중등은 초등 어휘를 합친 풀 기준이라 회차별로 따로 저장)
--   session_word_id    : 빈칸 문장의 주인(정답) — 초등 문장이 중등 회차에서 쓰이면 초등 sw id
--   pool               : { "후보 word_master_id": 적합도 }
--        -1 문법 탈락(조사·받침·~하다)  0 말 안 됨(쉬움)  1 골디락스(우선)  2 거의 맞음(모자랄 때만)  3 들어맞음(정답 중복, 사용 금지)
--   pool에 없는 후보 = 사용 안 함
CREATE TABLE IF NOT EXISTS public.fill_pools (
  context_session_id bigint NOT NULL REFERENCES public.sessions(id),
  session_word_id    bigint NOT NULL REFERENCES public.session_words(id) ON DELETE CASCADE,
  pool               jsonb  NOT NULL,
  note               text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (context_session_id, session_word_id)
);
ALTER TABLE public.fill_pools ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_read ON public.fill_pools;
CREATE POLICY public_read ON public.fill_pools FOR SELECT USING (true);
GRANT SELECT ON public.fill_pools TO anon, authenticated;
