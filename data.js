// data.js — 뜻추론 훈도감 회차 데이터
//
// ──────────────────────────────────────────────────────
// DB 마이그레이션을 염두에 둔 평탄한(flat) 배열 구조
// 각 배열의 한 항목 = DB 테이블의 한 행(row)에 1:1 대응
// ──────────────────────────────────────────────────────
//
// [sessions 테이블]
//   id, area, mainChar, mainHun, mainHunFull, mainEum
//
// [words 테이블] — sessionId(FK) 추가하면 다회차 통합 가능
//   word         : 한글 (회차 내 고유)
//   hanja        : 한자 표기
//   char1, hun1  : 첫 글자, 그 훈음
//   char2, hun2  : 둘째 글자, 그 훈음
//   meaning      : 정답 뜻
//   choices      : 선택지 4개 (배열, [0]번이 정답)
//   isInferQuiz  : 미발견추론 출제 가능 (boolean)
//   fillSentence : 빈칸채우기 문장 ('___' 자리에 단어 삽입)
//   sentenceText : 문장속추론용 문장 (null이면 미출제)
//   sentenceChoices : 문장속추론용 선택지 ([0]번 정답, null이면 미출제)
//
// [wrongAnswers 테이블]
//   word, feedback
//
// [nextPreview] — sessions의 nextSessionId(FK)로 대체 가능

var SESSION = {
  id: 1,
  area: '환경과 생물',
  mainChar: '生',
  mainHun: '날',
  mainHunFull: '날 생',
  mainEum: '태어나다 · 살다 · 자라다',

  words: [
    {
      word:'야생', hanja:'野生',
      char1:'野', hun1:'들 야', char2:'生', hun2:'날 생',
      meaning:'들이나 산에서 저절로 나서 자라는 것',
      choices:['들이나 산에서 저절로 살아가는 것','학교에서 공부하는 사람','집에서 기르는 동물','물속에서만 사는 것'],
      isInferQuiz:false,
      fillSentence:'도시에서 자란 강아지와 달리, 늑대는 들판에서 ___으로 살아간다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생물', hanja:'生物',
      char1:'生', hun1:'날 생', char2:'物', hun2:'물건 물',
      meaning:'살아 숨 쉬고 움직이는 모든 것',
      choices:['살아 숨 쉬고 움직이는 것','땅속에 묻혀 있는 것','하늘을 나는 것','물속에만 사는 것'],
      isInferQuiz:false,
      fillSentence:'식물도 동물도 세균도 모두 살아 숨 쉬는 ___이다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'학생', hanja:'學生',
      char1:'學', hun1:'배울 학', char2:'生', hun2:'날 생',
      meaning:'배우며 살아가는 사람',
      choices:['배우며 살아가는 사람','가르치는 사람','물건을 파는 사람','농사짓는 사람'],
      isInferQuiz:false,
      fillSentence:'선생님께 수학을 배우고 있는 민준이는 열심히 공부하는 ___이다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생일', hanja:'生日',
      char1:'生', hun1:'날 생', char2:'日', hun2:'날 일',
      meaning:'태어난 날',
      choices:['태어난 날','해가 뜨는 날','일이 많은 날','공부하는 날'],
      isInferQuiz:false,
      fillSentence:'엄마가 세상에 나를 낳아주신 날인 ___에 케이크를 먹었다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생화', hanja:'生花',
      char1:'生', hun1:'날 생', char2:'花', hun2:'꽃 화',
      meaning:'살아있는 진짜 꽃',
      choices:['살아있는 진짜 꽃','그림 속의 꽃','조화(인공 꽃)','시든 꽃'],
      isInferQuiz:false,
      fillSentence:'꽃집에서 사온 ___는 조화보다 훨씬 향기롭고 싱싱하다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'위생', hanja:'衛生',
      char1:'衛', hun1:'지킬 위', char2:'生', hun2:'날 생',
      meaning:'몸을 깨끗이 하여 건강을 지키는 것',
      choices:['몸을 깨끗이 하여 건강을 지키는 것','빠르게 달리는 것','높이 올라가는 것','음식을 많이 먹는 것'],
      isInferQuiz:false,
      fillSentence:'음식을 먹기 전에 손을 씻는 것은 건강을 지키는 ___ 습관이다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'선생', hanja:'先生',
      char1:'先', hun1:'먼저 선', char2:'生', hun2:'날 생',
      meaning:'먼저 태어나 가르쳐 주는 사람',
      choices:['먼저 태어나 가르쳐 주는 사람','나중에 태어난 사람','배우는 사람','일하는 사람'],
      isInferQuiz:false,
      fillSentence:'우리보다 먼저 배우고 지식을 쌓아 가르쳐 주는 분이 바로 ___님이다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생명', hanja:'生命',
      char1:'生', hun1:'날 생', char2:'命', hun2:'목숨 명',
      meaning:'살아있는 목숨',
      choices:['살아있는 목숨','빠른 것','높은 것','넓은 것'],
      isInferQuiz:false,
      fillSentence:'봄이 되자 겨울 동안 잠들었던 씨앗이 깨어나 ___의 싹을 틔웠다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생활', hanja:'生活',
      char1:'生', hun1:'날 생', char2:'活', hun2:'살 활',
      meaning:'살아가며 지내는 일상',
      choices:['살아가며 지내는 일상','공부하는 것','운동하는 것','먹는 것'],
      isInferQuiz:false,
      fillSentence:'매일 밥 먹고 학교 가고 잠자는 것, 이것이 모두 우리의 ___이다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'탄생', hanja:'誕生',
      char1:'誕', hun1:'태어날 탄', char2:'生', hun2:'날 생',
      meaning:'새로 태어나는 것',
      choices:['새로 태어나는 것','오래된 것','사라지는 것','변하는 것'],
      isInferQuiz:false,
      fillSentence:'아기 판다가 태어났다는 소식에 동물원 직원들은 ___을 축하했다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생선', hanja:'生鮮',
      char1:'生', hun1:'날 생', char2:'鮮', hun2:'신선할 선',
      meaning:'살아있거나 신선한 물고기',
      choices:['살아있거나 신선한 물고기','말린 물고기','냉동 생선','통조림 생선'],
      isInferQuiz:false,
      fillSentence:'시장에서 방금 잡아온 싱싱한 ___은 비린내가 거의 나지 않았다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생산', hanja:'生産',
      char1:'生', hun1:'날 생', char2:'産', hun2:'낳을 산',
      meaning:'물건이나 작물을 만들어 내는 것',
      choices:['물건이나 작물을 만들어 내는 것','물건을 버리는 것','물건을 빌리는 것','물건을 고치는 것'],
      isInferQuiz:false,
      fillSentence:'이 공장에서는 하루에 수천 개의 자동차를 ___한다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생태', hanja:'生態',
      char1:'生', hun1:'날 생', char2:'態', hun2:'모습 태',
      meaning:'생물이 살아가는 모습과 환경',
      choices:['생물이 살아가는 모습과 환경','사람이 운동하는 방법','식물이 꽃 피우는 것','동물이 잠자는 것'],
      isInferQuiz:false,
      fillSentence:'강이 오염되면 그 안에 사는 물고기들의 ___가 위협받는다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'출생', hanja:'出生',
      char1:'出', hun1:'날 출', char2:'生', hun2:'날 생',
      meaning:'세상에 태어나는 것',
      choices:['세상에 태어나는 것','세상을 떠나는 것','여행을 떠나는 것','학교에 가는 것'],
      isInferQuiz:false,
      fillSentence:'병원에서 ___한 아이는 출생신고서에 이름이 기록된다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생애', hanja:'生涯',
      char1:'生', hun1:'날 생', char2:'涯', hun2:'물가 애',
      meaning:'태어나서 죽을 때까지의 삶 전체',
      choices:['태어나서 죽을 때까지의 삶 전체','하루 동안의 일과','한 학기 동안의 공부','방학 동안의 생활'],
      isInferQuiz:false,
      fillSentence:'그는 ___의 대부분을 어려운 이웃을 돕는 데 바쳤다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생계', hanja:'生計',
      char1:'生', hun1:'날 생', char2:'計', hun2:'셀 계',
      meaning:'살아가기 위해 돈을 버는 것',
      choices:['살아가기 위해 돈을 버는 것','공부를 계획하는 것','여행을 준비하는 것','친구를 만나는 것'],
      isInferQuiz:false,
      fillSentence:'아버지는 가족의 ___를 위해 매일 아침 일찍 일터로 나가신다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생리', hanja:'生理',
      char1:'生', hun1:'날 생', char2:'理', hun2:'이치 리',
      meaning:'살아있는 몸이 움직이는 원리',
      choices:['살아있는 몸이 움직이는 원리','건물을 만드는 방법','기계를 고치는 방법','음식을 만드는 방법'],
      isInferQuiz:false,
      fillSentence:'우리 몸은 복잡한 ___ 작용으로 체온과 혈압을 유지한다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생식', hanja:'生殖',
      char1:'生', hun1:'날 생', char2:'殖', hun2:'불릴 식',
      meaning:'자손을 낳아 종족을 이어가는 것',
      choices:['자손을 낳아 종족을 이어가는 것','음식을 먹고 소화하는 것','잠을 자고 쉬는 것','운동으로 몸을 키우는 것'],
      isInferQuiz:false,
      fillSentence:'동물들은 ___을 통해 자신의 자손을 세상에 남긴다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생체', hanja:'生體',
      char1:'生', hun1:'날 생', char2:'體', hun2:'몸 체',
      meaning:'살아있는 생물의 몸',
      choices:['살아있는 생물의 몸','죽은 후의 몸','기계로 만든 몸','그림 속의 몸'],
      isInferQuiz:false,
      fillSentence:'과학자들은 ___ 실험을 통해 새로운 약이 안전한지 확인했다.',
      sentenceText:'과학자들은 생체 실험을 통해 이 약이 사람 몸에 안전한지 확인했다.',
      sentenceChoices:['살아있는 생물의 몸','죽은 후의 몸','기계로 만든 몸','그림 속의 몸']
    },
    {
      word:'생성', hanja:'生成',
      char1:'生', hun1:'날 생', char2:'成', hun2:'이룰 성',
      meaning:'새로 만들어지거나 생겨나는 것',
      choices:['새로 만들어지거나 생겨나는 것','오래된 것이 없어지는 것','크게 자라나는 것','멀리 퍼져나가는 것'],
      isInferQuiz:false,
      fillSentence:'새로운 세포가 ___되는 속도는 나이가 들수록 점점 느려진다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'발생', hanja:'發生',
      char1:'發', hun1:'필 발', char2:'生', hun2:'날 생',
      meaning:'어떤 일이 처음으로 생겨나는 것',
      choices:['어떤 일이 처음으로 생겨나는 것','오래된 것이 없어지는 것','물건을 나눠 주는 것','사람이 모이는 것'],
      isInferQuiz:false,
      fillSentence:'갑자기 화재가 ___하면 즉시 119에 신고해야 한다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'평생', hanja:'平生',
      char1:'平', hun1:'평평할 평', char2:'生', hun2:'날 생',
      meaning:'태어나서 죽을 때까지의 온 삶',
      choices:['태어나서 죽을 때까지의 온 삶','하루 동안의 생활','한 달 동안의 생활','1년 동안의 생활'],
      isInferQuiz:false,
      fillSentence:'___ 동안 아이들을 가르쳐 온 선생님이 드디어 은퇴하셨다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'고생', hanja:'苦生',
      char1:'苦', hun1:'쓸 고', char2:'生', hun2:'날 생',
      meaning:'힘들고 어렵게 살아가는 것',
      choices:['힘들고 어렵게 살아가는 것','즐겁고 편하게 사는 것','빠르게 달리는 것','높이 올라가는 것'],
      isInferQuiz:false,
      fillSentence:'부모님은 우리를 키우기 위해 정말 많은 ___을 하셨다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'인생', hanja:'人生',
      char1:'人', hun1:'사람 인', char2:'生', hun2:'날 생',
      meaning:'사람이 태어나서 살아가는 일',
      choices:['사람이 태어나서 살아가는 일','동물이 먹이를 찾는 일','식물이 자라는 일','하늘이 맑아지는 일'],
      isInferQuiz:false,
      fillSentence:'열심히 노력하며 꿈을 향해 나아가는 것이 아름다운 ___이다.',
      sentenceText:null, sentenceChoices:null
    },

    // ── isInferQuiz:true — 미발견 시 추론 퀴즈에 출제 ──
    {
      word:'공생', hanja:'共生',
      char1:'共', hun1:'함께 공', char2:'生', hun2:'날 생',
      meaning:'서로 도우며 함께 살아가는 것',
      choices:['서로 도우며 함께 살아가는 것','혼자서만 살아가는 것','싸우며 살아가는 것','도망가며 살아가는 것'],
      isInferQuiz:true,
      fillSentence:'악어가 입을 벌리면 새가 이빨 사이를 청소해 주며 ___한다.',
      sentenceText:'악어가 입을 벌리면 새가 이빨 사이 음식을 먹어주는 것처럼, 두 동물은 공생한다.',
      sentenceChoices:['서로 도우며 함께 살아가는 것','혼자서만 살아가는 것','싸우며 살아가는 것','멀리 떨어져 사는 것']
    },
    {
      word:'생존', hanja:'生存',
      char1:'生', hun1:'날 생', char2:'存', hun2:'있을 존',
      meaning:'살아서 계속 존재하는 것',
      choices:['살아서 계속 존재하는 것','죽어서 사라지는 것','잠들어 있는 것','변해서 없어지는 것'],
      isInferQuiz:true,
      fillSentence:'사막에서 ___하려면 무엇보다 물을 아껴 써야 한다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'신생', hanja:'新生',
      char1:'新', hun1:'새 신', char2:'生', hun2:'날 생',
      meaning:'새롭게 태어나거나 생겨나는 것',
      choices:['새롭게 태어나거나 생겨나는 것','오래되어 낡은 것','천천히 사라지는 것','그대로 남아있는 것'],
      isInferQuiz:true,
      fillSentence:'___ 아는 태어난 지 얼마 되지 않아 아직 눈도 잘 못 뜬다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생기', hanja:'生氣',
      char1:'生', hun1:'날 생', char2:'氣', hun2:'기운 기',
      meaning:'살아있는 느낌의 활발한 기운',
      choices:['살아있는 느낌의 활발한 기운','지치고 피곤한 기운','차갑고 쌀쌀한 기운','조용하고 무거운 기운'],
      isInferQuiz:true,
      fillSentence:'오래 앓다가 건강을 되찾은 그의 얼굴에 다시 ___가 넘쳤다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'소생', hanja:'蘇生',
      char1:'蘇', hun1:'깨어날 소', char2:'生', hun2:'날 생',
      meaning:'죽어가던 것이 다시 살아나는 것',
      choices:['죽어가던 것이 다시 살아나는 것','처음으로 태어나는 것','더 빠르게 자라는 것','멀리 떠나는 것'],
      isInferQuiz:true,
      fillSentence:'겨우내 말라있던 나무가 봄비를 맞고 ___하여 새 잎을 피웠다.',
      sentenceText:'겨우내 말라있던 나무가 봄비를 맞고 소생하여 새 잎을 피워냈다.',
      sentenceChoices:['죽어가던 것이 다시 살아나는 것','처음으로 태어나는 것','멀리 떠나는 것','빠르게 자라는 것']
    },
    {
      word:'갱생', hanja:'更生',
      char1:'更', hun1:'다시 갱', char2:'生', hun2:'날 생',
      meaning:'나쁜 것을 버리고 새롭게 살아가는 것',
      choices:['나쁜 것을 버리고 새롭게 살아가는 것','처음으로 태어나는 것','공부를 시작하는 것','여행을 떠나는 것'],
      isInferQuiz:true,
      fillSentence:'나쁜 습관을 버리고 새로운 삶을 시작하는 것을 ___이라고 한다.',
      sentenceText:'교도소에서 나온 그는 나쁜 습관을 버리고 새 삶을 시작하며 갱생의 길을 걸었다.',
      sentenceChoices:['나쁜 것을 버리고 새롭게 살아가는 것','오랫동안 잠을 자는 것','빠르게 달리는 것','멀리 여행 가는 것']
    },
    {
      word:'생전', hanja:'生前',
      char1:'生', hun1:'날 생', char2:'前', hun2:'앞 전',
      meaning:'살아있을 때',
      choices:['살아있을 때','죽은 다음','학교 다닐 때','여행 중일 때'],
      isInferQuiz:true,
      fillSentence:'할머니는 ___에 항상 손자들에게 따뜻하게 대해 주셨다.',
      sentenceText:'할머니는 생전에 항상 아이들에게 따뜻하게 대해주셨다.',
      sentenceChoices:['살아있을 때','죽은 다음','오래전 옛날','태어나기 전']
    },
    {
      word:'생후', hanja:'生後',
      char1:'生', hun1:'날 생', char2:'後', hun2:'뒤 후',
      meaning:'태어난 다음',
      choices:['태어난 다음','태어나기 전','학교에 간 다음','잠든 다음'],
      isInferQuiz:true,
      fillSentence:'___ 100일이 된 아기의 얼굴에 처음으로 미소가 피어올랐다.',
      sentenceText:'생후 100일이 된 아기의 얼굴에 처음으로 미소가 피어올랐다.',
      sentenceChoices:['태어난 다음','태어나기 전','학교 간 다음','잠든 다음']
    },
    {
      word:'생사', hanja:'生死',
      char1:'生', hun1:'날 생', char2:'死', hun2:'죽을 사',
      meaning:'살고 죽는 것',
      choices:['살고 죽는 것','오고 가는 것','먹고 자는 것','웃고 우는 것'],
      isInferQuiz:true,
      fillSentence:'산에서 실종된 등산객의 ___를 확인하기 위해 구조대가 출동했다.',
      sentenceText:'산에서 길을 잃은 등산객의 생사를 확인하기 위해 구조대가 출동했다.',
      sentenceChoices:['살고 죽는 것','오고 가는 것','먹고 자는 것','웃고 우는 것']
    },
    {
      word:'민생', hanja:'民生',
      char1:'民', hun1:'백성 민', char2:'生', hun2:'날 생',
      meaning:'일반 사람들의 생활',
      choices:['일반 사람들의 생활','왕이나 귀족의 생활','동물들의 생활','식물들의 생활'],
      isInferQuiz:true,
      fillSentence:'새 대통령은 국민의 삶인 ___을 최우선 과제로 삼겠다고 했다.',
      sentenceText:'새 대통령은 "국민의 삶을 먼저 챙기겠다"며 민생을 최우선 과제로 삼았다.',
      sentenceChoices:['일반 사람들의 생활','왕이나 귀족의 생활','동물들의 생활','나라의 법']
    },
    {
      word:'생장', hanja:'生長',
      char1:'生', hun1:'날 생', char2:'長', hun2:'길 장',
      meaning:'태어나서 점점 자라나는 것',
      choices:['태어나서 점점 자라나는 것','빠르게 사라지는 것','천천히 줄어드는 것','그대로 멈춰있는 것'],
      isInferQuiz:true,
      fillSentence:'식물은 햇빛과 물이 충분해야 빠르게 ___할 수 있다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'생육', hanja:'生育',
      char1:'生', hun1:'날 생', char2:'育', hun2:'기를 육',
      meaning:'생물이 태어나서 자라는 것',
      choices:['생물이 태어나서 자라는 것','물건을 만들어 파는 것','음식을 요리하는 것','집을 짓는 것'],
      isInferQuiz:true,
      fillSentence:'건강한 ___을 위해서는 어린 시절부터 균형 잡힌 영양이 중요하다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'기생', hanja:'寄生',
      char1:'寄', hun1:'붙을 기', char2:'生', hun2:'날 생',
      meaning:'다른 생물에 붙어서 살아가는 것',
      choices:['다른 생물에 붙어서 살아가는 것','혼자서 독립적으로 사는 것','서로 도우며 함께 사는 것','무리를 지어 사는 것'],
      isInferQuiz:true,
      fillSentence:'겨우살이는 스스로 광합성을 하면서도 다른 나무에 ___하며 살아간다.',
      sentenceText:null, sentenceChoices:null
    },
    {
      word:'재생', hanja:'再生',
      char1:'再', hun1:'다시 재', char2:'生', hun2:'날 생',
      meaning:'죽거나 없어진 것이 다시 살아나는 것',
      choices:['죽거나 없어진 것이 다시 살아나는 것','처음으로 태어나는 것','빠르게 성장하는 것','천천히 사라지는 것'],
      isInferQuiz:true,
      fillSentence:'다 쓴 종이를 다시 만들어 쓰는 ___ 종이를 사용하자.',
      sentenceText:null, sentenceChoices:null
    }
  ],

  wrongAnswers: [
    { word:'환경', feedback:'環境 — 生이 들어가지 않아요' },
    { word:'보호', feedback:'保護 — 生이 들어가지 않아요' },
    { word:'갓생', feedback:'신조어예요! 한자어가 아닙니다' },
    { word:'생각', feedback:'순우리말이에요! 한자 분해가 안 돼요' }
  ],

  nextPreview: {
    char: '體',
    hunFull: '몸 체',
    relatedWords: '천체 · 개체 · 체육이 연결돼요'
  }
};
