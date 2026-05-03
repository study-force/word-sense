-- ════════════════════════════════════════════════════════════════
-- 샘플 회차 데이터 — 1회차 (生, 환경과 생물)
-- 현재 data.js의 SESSION을 SQL로 변환한 것
-- 검수 완료 본 import 전, 앱 fetch 코드 검증용 샘플 데이터
--
-- 실행 순서:
--   01_content_schema.sql → 02_seed_areas.sql → 이 파일
--
-- 재실행 안전성:
--   word_master는 word UNIQUE라 ON CONFLICT 처리.
--   sessions/session_words는 (area_id, round_no) 또는 (session_id, word_master_id) UNIQUE.
-- ════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════
-- 1. session 입력 (生 — 생물 1회차)
-- ════════════════════════════════════════
INSERT INTO sessions (area_id, round_no, main_char, main_char_hangul, main_hun_short, main_eum, main_etymology, main_meanings, total_words)
VALUES (
  (SELECT id FROM areas WHERE slug = 'biology'),
  1,
  '生',
  '날 생',
  '날',
  '태어나다 · 살다 · 자라다',
  '땅(土) 위로 새싹이 자라나는 모습을 본떠 만든 글자입니다. 처음 ‘태어나다’의 뜻에서 출발하여, ‘살다’, ‘자라나다’, ‘생기다’로 의미가 확장되었습니다.',
  '[
    {"hun": "나다 · 태어나다", "examples": ["출생", "생일", "탄생"]},
    {"hun": "살다 · 살아있다", "examples": ["생존", "인생", "생활"]},
    {"hun": "자라나다 · 생기다", "examples": ["생물", "발생", "생산"]}
  ]'::jsonb,
  38
)
ON CONFLICT (area_id, round_no) DO UPDATE SET
  main_char = EXCLUDED.main_char,
  main_char_hangul = EXCLUDED.main_char_hangul,
  main_hun_short = EXCLUDED.main_hun_short,
  main_eum = EXCLUDED.main_eum,
  main_etymology = EXCLUDED.main_etymology,
  main_meanings = EXCLUDED.main_meanings,
  total_words = EXCLUDED.total_words,
  updated_at = NOW();


-- ════════════════════════════════════════
-- 2. word_master 입력 (38개 어휘)
--   word UNIQUE이므로 충돌 시 갱신
-- ════════════════════════════════════════
INSERT INTO word_master (word, hanja, char1, hun1, char2, hun2, meaning) VALUES
  ('야생', '野生', '野', '들 야', '生', '날 생', '들이나 산에서 저절로 나서 자라는 것'),
  ('생물', '生物', '生', '날 생', '物', '물건 물', '살아 숨 쉬고 움직이는 모든 것'),
  ('학생', '學生', '學', '배울 학', '生', '날 생', '배우며 살아가는 사람'),
  ('생일', '生日', '生', '날 생', '日', '날 일', '태어난 날'),
  ('생화', '生花', '生', '날 생', '花', '꽃 화', '살아있는 진짜 꽃'),
  ('위생', '衛生', '衛', '지킬 위', '生', '날 생', '몸을 깨끗이 하여 건강을 지키는 것'),
  ('선생', '先生', '先', '먼저 선', '生', '날 생', '먼저 태어나 가르쳐 주는 사람'),
  ('생명', '生命', '生', '날 생', '命', '목숨 명', '살아있는 목숨'),
  ('생활', '生活', '生', '날 생', '活', '살 활', '살아가며 지내는 일상'),
  ('탄생', '誕生', '誕', '태어날 탄', '生', '날 생', '새로 태어나는 것'),
  ('생선', '生鮮', '生', '날 생', '鮮', '신선할 선', '살아있거나 신선한 물고기'),
  ('생산', '生産', '生', '날 생', '産', '낳을 산', '물건이나 작물을 만들어 내는 것'),
  ('생태', '生態', '生', '날 생', '態', '모습 태', '생물이 살아가는 모습과 환경'),
  ('출생', '出生', '出', '날 출', '生', '날 생', '세상에 태어나는 것'),
  ('생애', '生涯', '生', '날 생', '涯', '물가 애', '태어나서 죽을 때까지의 삶 전체'),
  ('생계', '生計', '生', '날 생', '計', '셀 계', '살아가기 위해 돈을 버는 것'),
  ('생리', '生理', '生', '날 생', '理', '이치 리', '살아있는 몸이 움직이는 원리'),
  ('생식', '生殖', '生', '날 생', '殖', '불릴 식', '자손을 낳아 종족을 이어가는 것'),
  ('생체', '生體', '生', '날 생', '體', '몸 체', '살아있는 생물의 몸'),
  ('생성', '生成', '生', '날 생', '成', '이룰 성', '새로 만들어지거나 생겨나는 것'),
  ('발생', '發生', '發', '필 발', '生', '날 생', '어떤 일이 처음으로 생겨나는 것'),
  ('평생', '平生', '平', '평평할 평', '生', '날 생', '태어나서 죽을 때까지의 온 삶'),
  ('고생', '苦生', '苦', '쓸 고', '生', '날 생', '힘들고 어렵게 살아가는 것'),
  ('인생', '人生', '人', '사람 인', '生', '날 생', '사람이 태어나서 살아가는 일'),
  ('공생', '共生', '共', '함께 공', '生', '날 생', '서로 도우며 함께 살아가는 것'),
  ('생존', '生存', '生', '날 생', '存', '있을 존', '살아서 계속 존재하는 것'),
  ('신생', '新生', '新', '새 신', '生', '날 생', '새롭게 태어나거나 생겨나는 것'),
  ('생기', '生氣', '生', '날 생', '氣', '기운 기', '살아있는 느낌의 활발한 기운'),
  ('소생', '蘇生', '蘇', '깨어날 소', '生', '날 생', '죽어가던 것이 다시 살아나는 것'),
  ('갱생', '更生', '更', '다시 갱', '生', '날 생', '나쁜 것을 버리고 새롭게 살아가는 것'),
  ('생전', '生前', '生', '날 생', '前', '앞 전', '살아있을 때'),
  ('생후', '生後', '生', '날 생', '後', '뒤 후', '태어난 다음'),
  ('생사', '生死', '生', '날 생', '死', '죽을 사', '살고 죽는 것'),
  ('민생', '民生', '民', '백성 민', '生', '날 생', '일반 사람들의 생활'),
  ('생장', '生長', '生', '날 생', '長', '길 장', '태어나서 점점 자라나는 것'),
  ('생육', '生育', '生', '날 생', '育', '기를 육', '생물이 태어나서 자라는 것'),
  ('기생', '寄生', '寄', '붙을 기', '生', '날 생', '다른 생물에 붙어서 살아가는 것'),
  ('재생', '再生', '再', '다시 재', '生', '날 생', '죽거나 없어진 것이 다시 살아나는 것')
ON CONFLICT (word) DO UPDATE SET
  hanja = EXCLUDED.hanja,
  char1 = EXCLUDED.char1, hun1 = EXCLUDED.hun1,
  char2 = EXCLUDED.char2, hun2 = EXCLUDED.hun2,
  meaning = EXCLUDED.meaning,
  updated_at = NOW();


-- ════════════════════════════════════════
-- 3. session_words 입력 — 회차×어휘 매핑 (38개)
--   choices: 첫 항목이 정답, 나머지는 오답
-- ════════════════════════════════════════
WITH s AS (SELECT id FROM sessions WHERE area_id = (SELECT id FROM areas WHERE slug='biology') AND round_no = 1)
INSERT INTO session_words (session_id, word_master_id, fill_sentence, choices, is_infer_quiz, order_in_session)
SELECT s.id, wm.id, t.fill_sentence, t.choices::jsonb, t.is_infer_quiz, t.ord
FROM s, word_master wm
JOIN (VALUES
  ('야생',  '도시에서 자란 강아지와 달리, 늑대는 들판에서 ___으로 살아간다.',
   '[{"text":"들이나 산에서 저절로 살아가는 것","is_correct":true},{"text":"학교에서 공부하는 사람","is_correct":false},{"text":"집에서 기르는 동물","is_correct":false},{"text":"물속에서만 사는 것","is_correct":false}]', false, 1),
  ('생물',  '식물도 동물도 세균도 모두 살아 숨 쉬는 ___이다.',
   '[{"text":"살아 숨 쉬고 움직이는 것","is_correct":true},{"text":"땅속에 묻혀 있는 것","is_correct":false},{"text":"하늘을 나는 것","is_correct":false},{"text":"물속에만 사는 것","is_correct":false}]', false, 2),
  ('학생',  '선생님께 수학을 배우고 있는 민준이는 열심히 공부하는 ___이다.',
   '[{"text":"배우며 살아가는 사람","is_correct":true},{"text":"가르치는 사람","is_correct":false},{"text":"물건을 파는 사람","is_correct":false},{"text":"농사짓는 사람","is_correct":false}]', false, 3),
  ('생일',  '엄마가 세상에 나를 낳아주신 날인 ___에 케이크를 먹었다.',
   '[{"text":"태어난 날","is_correct":true},{"text":"해가 뜨는 날","is_correct":false},{"text":"일이 많은 날","is_correct":false},{"text":"공부하는 날","is_correct":false}]', false, 4),
  ('생화',  '꽃집에서 사온 ___는 조화보다 훨씬 향기롭고 싱싱하다.',
   '[{"text":"살아있는 진짜 꽃","is_correct":true},{"text":"그림 속의 꽃","is_correct":false},{"text":"조화(인공 꽃)","is_correct":false},{"text":"시든 꽃","is_correct":false}]', false, 5),
  ('위생',  '음식을 먹기 전에 손을 씻는 것은 건강을 지키는 ___ 습관이다.',
   '[{"text":"몸을 깨끗이 하여 건강을 지키는 것","is_correct":true},{"text":"빠르게 달리는 것","is_correct":false},{"text":"높이 올라가는 것","is_correct":false},{"text":"음식을 많이 먹는 것","is_correct":false}]', false, 6),
  ('선생',  '우리보다 먼저 배우고 지식을 쌓아 가르쳐 주는 분이 바로 ___님이다.',
   '[{"text":"먼저 태어나 가르쳐 주는 사람","is_correct":true},{"text":"나중에 태어난 사람","is_correct":false},{"text":"배우는 사람","is_correct":false},{"text":"일하는 사람","is_correct":false}]', false, 7),
  ('생명',  '봄이 되자 겨울 동안 잠들었던 씨앗이 깨어나 ___의 싹을 틔웠다.',
   '[{"text":"살아있는 목숨","is_correct":true},{"text":"빠른 것","is_correct":false},{"text":"높은 것","is_correct":false},{"text":"넓은 것","is_correct":false}]', false, 8),
  ('생활',  '매일 밥 먹고 학교 가고 잠자는 것, 이것이 모두 우리의 ___이다.',
   '[{"text":"살아가며 지내는 일상","is_correct":true},{"text":"공부하는 것","is_correct":false},{"text":"운동하는 것","is_correct":false},{"text":"먹는 것","is_correct":false}]', false, 9),
  ('탄생',  '아기 판다가 태어났다는 소식에 동물원 직원들은 ___을 축하했다.',
   '[{"text":"새로 태어나는 것","is_correct":true},{"text":"오래된 것","is_correct":false},{"text":"사라지는 것","is_correct":false},{"text":"변하는 것","is_correct":false}]', false, 10),
  ('생선',  '시장에서 방금 잡아온 싱싱한 ___은 비린내가 거의 나지 않았다.',
   '[{"text":"살아있거나 신선한 물고기","is_correct":true},{"text":"말린 물고기","is_correct":false},{"text":"냉동 생선","is_correct":false},{"text":"통조림 생선","is_correct":false}]', false, 11),
  ('생산',  '이 공장에서는 하루에 수천 개의 자동차를 ___한다.',
   '[{"text":"물건이나 작물을 만들어 내는 것","is_correct":true},{"text":"물건을 버리는 것","is_correct":false},{"text":"물건을 빌리는 것","is_correct":false},{"text":"물건을 고치는 것","is_correct":false}]', false, 12),
  ('생태',  '강이 오염되면 그 안에 사는 물고기들의 ___가 위협받는다.',
   '[{"text":"생물이 살아가는 모습과 환경","is_correct":true},{"text":"사람이 운동하는 방법","is_correct":false},{"text":"식물이 꽃 피우는 것","is_correct":false},{"text":"동물이 잠자는 것","is_correct":false}]', false, 13),
  ('출생',  '병원에서 ___한 아이는 출생신고서에 이름이 기록된다.',
   '[{"text":"세상에 태어나는 것","is_correct":true},{"text":"세상을 떠나는 것","is_correct":false},{"text":"여행을 떠나는 것","is_correct":false},{"text":"학교에 가는 것","is_correct":false}]', false, 14),
  ('생애',  '그는 ___의 대부분을 어려운 이웃을 돕는 데 바쳤다.',
   '[{"text":"태어나서 죽을 때까지의 삶 전체","is_correct":true},{"text":"하루 동안의 일과","is_correct":false},{"text":"한 학기 동안의 공부","is_correct":false},{"text":"방학 동안의 생활","is_correct":false}]', false, 15),
  ('생계',  '아버지는 가족의 ___를 위해 매일 아침 일찍 일터로 나가신다.',
   '[{"text":"살아가기 위해 돈을 버는 것","is_correct":true},{"text":"공부를 계획하는 것","is_correct":false},{"text":"여행을 준비하는 것","is_correct":false},{"text":"친구를 만나는 것","is_correct":false}]', false, 16),
  ('생리',  '우리 몸은 복잡한 ___ 작용으로 체온과 혈압을 유지한다.',
   '[{"text":"살아있는 몸이 움직이는 원리","is_correct":true},{"text":"건물을 만드는 방법","is_correct":false},{"text":"기계를 고치는 방법","is_correct":false},{"text":"음식을 만드는 방법","is_correct":false}]', false, 17),
  ('생식',  '동물들은 ___을 통해 자신의 자손을 세상에 남긴다.',
   '[{"text":"자손을 낳아 종족을 이어가는 것","is_correct":true},{"text":"음식을 먹고 소화하는 것","is_correct":false},{"text":"잠을 자고 쉬는 것","is_correct":false},{"text":"운동으로 몸을 키우는 것","is_correct":false}]', false, 18),
  ('생체',  '과학자들은 ___ 실험을 통해 새로운 약이 안전한지 확인했다.',
   '[{"text":"살아있는 생물의 몸","is_correct":true},{"text":"죽은 후의 몸","is_correct":false},{"text":"기계로 만든 몸","is_correct":false},{"text":"그림 속의 몸","is_correct":false}]', false, 19),
  ('생성',  '새로운 세포가 ___되는 속도는 나이가 들수록 점점 느려진다.',
   '[{"text":"새로 만들어지거나 생겨나는 것","is_correct":true},{"text":"오래된 것이 없어지는 것","is_correct":false},{"text":"크게 자라나는 것","is_correct":false},{"text":"멀리 퍼져나가는 것","is_correct":false}]', false, 20),
  ('발생',  '갑자기 화재가 ___하면 즉시 119에 신고해야 한다.',
   '[{"text":"어떤 일이 처음으로 생겨나는 것","is_correct":true},{"text":"오래된 것이 없어지는 것","is_correct":false},{"text":"물건을 나눠 주는 것","is_correct":false},{"text":"사람이 모이는 것","is_correct":false}]', false, 21),
  ('평생',  '___ 동안 아이들을 가르쳐 온 선생님이 드디어 은퇴하셨다.',
   '[{"text":"태어나서 죽을 때까지의 온 삶","is_correct":true},{"text":"하루 동안의 생활","is_correct":false},{"text":"한 달 동안의 생활","is_correct":false},{"text":"1년 동안의 생활","is_correct":false}]', false, 22),
  ('고생',  '부모님은 우리를 키우기 위해 정말 많은 ___을 하셨다.',
   '[{"text":"힘들고 어렵게 살아가는 것","is_correct":true},{"text":"즐겁고 편하게 사는 것","is_correct":false},{"text":"빠르게 달리는 것","is_correct":false},{"text":"높이 올라가는 것","is_correct":false}]', false, 23),
  ('인생',  '열심히 노력하며 꿈을 향해 나아가는 것이 아름다운 ___이다.',
   '[{"text":"사람이 태어나서 살아가는 일","is_correct":true},{"text":"동물이 먹이를 찾는 일","is_correct":false},{"text":"식물이 자라는 일","is_correct":false},{"text":"하늘이 맑아지는 일","is_correct":false}]', false, 24),
  ('공생',  '악어가 입을 벌리면 새가 이빨 사이를 청소해 주며 ___한다.',
   '[{"text":"서로 도우며 함께 살아가는 것","is_correct":true},{"text":"혼자서만 살아가는 것","is_correct":false},{"text":"싸우며 살아가는 것","is_correct":false},{"text":"도망가며 살아가는 것","is_correct":false}]', true, 25),
  ('생존',  '사막에서 ___하려면 무엇보다 물을 아껴 써야 한다.',
   '[{"text":"살아서 계속 존재하는 것","is_correct":true},{"text":"죽어서 사라지는 것","is_correct":false},{"text":"잠들어 있는 것","is_correct":false},{"text":"변해서 없어지는 것","is_correct":false}]', true, 26),
  ('신생',  '___ 아는 태어난 지 얼마 되지 않아 아직 눈도 잘 못 뜬다.',
   '[{"text":"새롭게 태어나거나 생겨나는 것","is_correct":true},{"text":"오래되어 낡은 것","is_correct":false},{"text":"천천히 사라지는 것","is_correct":false},{"text":"그대로 남아있는 것","is_correct":false}]', true, 27),
  ('생기',  '오래 앓다가 건강을 되찾은 그의 얼굴에 다시 ___가 넘쳤다.',
   '[{"text":"살아있는 느낌의 활발한 기운","is_correct":true},{"text":"지치고 피곤한 기운","is_correct":false},{"text":"차갑고 쌀쌀한 기운","is_correct":false},{"text":"조용하고 무거운 기운","is_correct":false}]', true, 28),
  ('소생',  '겨우내 말라있던 나무가 봄비를 맞고 ___하여 새 잎을 피웠다.',
   '[{"text":"죽어가던 것이 다시 살아나는 것","is_correct":true},{"text":"처음으로 태어나는 것","is_correct":false},{"text":"더 빠르게 자라는 것","is_correct":false},{"text":"멀리 떠나는 것","is_correct":false}]', true, 29),
  ('갱생',  '나쁜 습관을 버리고 새로운 삶을 시작하는 것을 ___이라고 한다.',
   '[{"text":"나쁜 것을 버리고 새롭게 살아가는 것","is_correct":true},{"text":"처음으로 태어나는 것","is_correct":false},{"text":"공부를 시작하는 것","is_correct":false},{"text":"여행을 떠나는 것","is_correct":false}]', true, 30),
  ('생전',  '할머니는 ___에 항상 손자들에게 따뜻하게 대해 주셨다.',
   '[{"text":"살아있을 때","is_correct":true},{"text":"죽은 다음","is_correct":false},{"text":"학교 다닐 때","is_correct":false},{"text":"여행 중일 때","is_correct":false}]', true, 31),
  ('생후',  '___ 100일이 된 아기의 얼굴에 처음으로 미소가 피어올랐다.',
   '[{"text":"태어난 다음","is_correct":true},{"text":"태어나기 전","is_correct":false},{"text":"학교에 간 다음","is_correct":false},{"text":"잠든 다음","is_correct":false}]', true, 32),
  ('생사',  '산에서 실종된 등산객의 ___를 확인하기 위해 구조대가 출동했다.',
   '[{"text":"살고 죽는 것","is_correct":true},{"text":"오고 가는 것","is_correct":false},{"text":"먹고 자는 것","is_correct":false},{"text":"웃고 우는 것","is_correct":false}]', true, 33),
  ('민생',  '새 대통령은 국민의 삶인 ___을 최우선 과제로 삼겠다고 했다.',
   '[{"text":"일반 사람들의 생활","is_correct":true},{"text":"왕이나 귀족의 생활","is_correct":false},{"text":"동물들의 생활","is_correct":false},{"text":"식물들의 생활","is_correct":false}]', true, 34),
  ('생장',  '식물은 햇빛과 물이 충분해야 빠르게 ___할 수 있다.',
   '[{"text":"태어나서 점점 자라나는 것","is_correct":true},{"text":"빠르게 사라지는 것","is_correct":false},{"text":"천천히 줄어드는 것","is_correct":false},{"text":"그대로 멈춰있는 것","is_correct":false}]', true, 35),
  ('생육',  '건강한 ___을 위해서는 어린 시절부터 균형 잡힌 영양이 중요하다.',
   '[{"text":"생물이 태어나서 자라는 것","is_correct":true},{"text":"물건을 만들어 파는 것","is_correct":false},{"text":"음식을 요리하는 것","is_correct":false},{"text":"집을 짓는 것","is_correct":false}]', true, 36),
  ('기생',  '겨우살이는 스스로 광합성을 하면서도 다른 나무에 ___하며 살아간다.',
   '[{"text":"다른 생물에 붙어서 살아가는 것","is_correct":true},{"text":"혼자서 독립적으로 사는 것","is_correct":false},{"text":"서로 도우며 함께 사는 것","is_correct":false},{"text":"무리를 지어 사는 것","is_correct":false}]', true, 37),
  ('재생',  '다 쓴 종이를 다시 만들어 쓰는 ___ 종이를 사용하자.',
   '[{"text":"죽거나 없어진 것이 다시 살아나는 것","is_correct":true},{"text":"처음으로 태어나는 것","is_correct":false},{"text":"빠르게 성장하는 것","is_correct":false},{"text":"천천히 사라지는 것","is_correct":false}]', true, 38)
) AS t(word, fill_sentence, choices, is_infer_quiz, ord) ON wm.word = t.word
ON CONFLICT (session_id, word_master_id) DO UPDATE SET
  fill_sentence = EXCLUDED.fill_sentence,
  choices = EXCLUDED.choices,
  is_infer_quiz = EXCLUDED.is_infer_quiz,
  order_in_session = EXCLUDED.order_in_session,
  updated_at = NOW();


-- ════════════════════════════════════════
-- 4. wrong_words 입력 — 이 회차의 오답 피드백
-- ════════════════════════════════════════
WITH s AS (SELECT id FROM sessions WHERE area_id = (SELECT id FROM areas WHERE slug='biology') AND round_no = 1)
INSERT INTO wrong_words (session_id, word, feedback)
SELECT s.id, t.word, t.feedback
FROM s, (VALUES
  ('환경', '環境 — 生이 들어가지 않아요'),
  ('보호', '保護 — 生이 들어가지 않아요'),
  ('갓생', '신조어예요! 한자어가 아닙니다'),
  ('생각', '순우리말이에요! 한자 분해가 안 돼요')
) AS t(word, feedback)
ON CONFLICT (session_id, word) DO UPDATE SET
  feedback = EXCLUDED.feedback;


-- ════════════════════════════════════════
-- 5. 검증 쿼리 (실행 후 확인용)
-- ════════════════════════════════════════
-- 회차 한 줄
SELECT id, area_id, round_no, main_char, total_words FROM sessions WHERE area_id = (SELECT id FROM areas WHERE slug='biology');

-- 어휘 개수 (38이어야 함)
SELECT COUNT(*) AS word_master_count FROM word_master;

-- session_words 개수 (38이어야 함)
SELECT COUNT(*) AS session_words_count FROM session_words;

-- wrong_words 개수 (4여야 함)
SELECT COUNT(*) AS wrong_words_count FROM wrong_words;

-- v_session_word_full로 회차+어휘 통합 확인 (38행)
SELECT round_no, order_in_session, word, hanja, is_infer_quiz
FROM v_session_word_full
WHERE session_id = (SELECT id FROM sessions WHERE area_id = (SELECT id FROM areas WHERE slug='biology') AND round_no = 1)
ORDER BY order_in_session
LIMIT 10;
