// data-supabase.js — Supabase에서 회차 데이터 fetch
//
// data.js의 정적 SESSION을 DB fetch로 대체.
// word-sense.html은 window.SESSION_READY (Promise) 를 await 하면 됨.
//
// ─ 사용법 ──────────────────────────────────────────────
//   word-sense.html의 <script src="data.js"></script> 자리에:
//     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//     <script src="data-supabase.js"></script>
//
// ─ 환경 변수 ───────────────────────────────────────────
//   anon key는 공개 키 — 프론트엔드 코드에 노출 OK (서비스 정책상 안전)
//   service_role key는 절대 여기 X (백엔드 전용)


// ════════════════════════════════════════
// 설정
// ════════════════════════════════════════
const SUPABASE_URL = 'https://fokuojmzhttxfkmiutmf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZva3Vvam16aHR0eGZrbWl1dG1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MDYwOTksImV4cCI6MjA5MzM4MjA5OX0.FuYv59ufKteXKusvAhJktBNWntMnWmxctQoHquaPKVA';

// 로드할 회차 — URL 파라미터로 동적 지정 가능 (테스트 편의):
//   ?area=biology&round=1   → 생물 1회차
//   ?round=2                → 현재 영역 그대로, 2회차
//   파라미터 없으면 default(생물 1회차)
const _params = new URLSearchParams(location.search);
const TARGET_AREA_SLUG = _params.get('area') || 'biology';
const TARGET_ROUND_NO  = parseInt(_params.get('round'), 10) || 1;


// ════════════════════════════════════════
// SESSION_READY — inline script가 await할 Promise
// ════════════════════════════════════════
window.SESSION_READY = (async function loadSession() {
  // Supabase 클라이언트 (CDN으로 로드된 supabase 글로벌 사용)
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  try {
    // 1. 영역 ID 조회
    const { data: areaRow, error: e1 } = await client
      .from('areas')
      .select('id, name_ko')
      .eq('slug', TARGET_AREA_SLUG)
      .single();
    if (e1) throw e1;

    // 2. 회차 정보
    const { data: sess, error: e2 } = await client
      .from('sessions')
      .select('id, round_no, main_char, main_char_hangul, main_hun_short, main_eum, main_etymology, main_meanings')
      .eq('area_id', areaRow.id)
      .eq('round_no', TARGET_ROUND_NO)
      .single();
    if (e2) throw e2;

    // 3. 회차 어휘 (view 활용 — 한 번에 통합 조회)
    const { data: wordRows, error: e3 } = await client
      .from('v_session_word_full')
      .select('word, hanja, char1, hun1, char2, hun2, meaning, fill_sentence, choices, is_infer_quiz, order_in_session')
      .eq('session_id', sess.id)
      .order('order_in_session');
    if (e3) throw e3;

    // 4. 회차 오답 피드백
    const { data: wrongs, error: e4 } = await client
      .from('wrong_words')
      .select('word, feedback')
      .eq('session_id', sess.id);
    if (e4) throw e4;

    // 5. data.js의 SESSION 형식으로 변환
    window.SESSION = {
      id: sess.round_no,
      area: areaRow.name_ko,
      mainChar: sess.main_char,
      mainHun:  sess.main_hun_short,
      mainHunFull: sess.main_char_hangul,
      mainEum:  sess.main_eum,
      mainEtymology: sess.main_etymology,
      mainMeanings:  sess.main_meanings || [],

      // DB choices: [{text, is_correct}, ...] → 앱 형식: [정답, 오답1, 오답2, 오답3]
      words: wordRows.map(function(r) {
        const correct = (r.choices || []).find(function(c){ return c.is_correct; });
        const wrongChoices = (r.choices || []).filter(function(c){ return !c.is_correct; });
        return {
          word: r.word,
          hanja: r.hanja,
          char1: r.char1, hun1: r.hun1,
          char2: r.char2, hun2: r.hun2,
          meaning: r.meaning,
          choices: [correct ? correct.text : ''].concat(wrongChoices.map(function(c){ return c.text; })),
          isInferQuiz: r.is_infer_quiz,
          fillSentence: r.fill_sentence,
          // sentenceText/Choices는 현재 스키마에 없음 (필요 시 컬럼 추가)
          sentenceText: null,
          sentenceChoices: null
        };
      }),

      wrongAnswers: (wrongs || []).map(function(w) {
        return { word: w.word, feedback: w.feedback };
      }),

      // nextPreview는 추후 sessions.next_session_id FK 추가 시 채움
      nextPreview: null
    };

    console.log('[Supabase] SESSION loaded —',
      window.SESSION.area, window.SESSION.id + '회차',
      '·', window.SESSION.words.length + '개 어휘');

  } catch (err) {
    console.error('[Supabase] 데이터 로드 실패:', err);
    // 폴백: 알림 표시 (UX 개선 여지)
    alert('데이터를 불러오지 못했습니다. 새로고침해주세요.\n\n오류: ' + (err.message || err));
    throw err;
  }
})();
