-- 훈련 이어하기 (대표님 2026-10-29) — 회차 훈련 중간 상태를 서버에 저장 → 브라우저·기기 바꿔도 하던 지점부터
--   기준 = 회원 + 과정 + 영역 + 회차 (입장권이 아님 — 학원이 새 입장권으로 같은 회차를 열어도 이어짐)
--   state = 앱이 만든 진행 상황(찾은 어휘·힌트·확장 카드 위치·강화 문항 위치 등). 회차를 끝까지 마치면 지움
--   학생 기록이라 service_role만 (Edge wordsense-progress가 입장권으로 학생 확인 후 읽고 씀)
CREATE TABLE IF NOT EXISTS public.training_progress (
  member_no  bigint      NOT NULL,
  level      text        NOT NULL,
  area_id    integer     NOT NULL REFERENCES public.areas(id),
  round_no   integer     NOT NULL,
  state      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_no, level, area_id, round_no)
);
ALTER TABLE public.training_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_progress FROM anon, authenticated;
