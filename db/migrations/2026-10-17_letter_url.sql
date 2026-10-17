-- 主字 음훈 소리(한자 이름 낭독, 예: "날 생") — 어원 나레이션(narration_url)과 같은 방식 (대표님 2026-10-17)
--   Storage 'narration' 버킷의 letter_{유니코드hex}.mp3 공개 URL. 녹음 없는 글자는 NULL → 앱은 소리 없이 진행
--   원본: 콘텐츠/Na/음훈_mp3/{영역}/HE_{영역}_W_{NN}.mp3 (초등 회차별)
ALTER TABLE public.main_chars ADD COLUMN IF NOT EXISTS letter_url text;
