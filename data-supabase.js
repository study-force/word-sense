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
// 설정 — 현재 단일 환경 (PROD 전용)
//   모든 도메인(word.sfcenter.co.kr / word.sfos.kr / *.vercel.app / localhost)이
//   동일하게 word-master (PROD)를 바라봄.
//
//   ⚠️ 원래는 word.sfos.kr / localhost를 word-master-dev 로 분기하도록 작성되어 있었으나,
//      dev Supabase 프로젝트가 아직 생성되지 않은 상태라 분기를 임시로 제거.
//      dev 프로젝트 생성 후 환경 분기 복구 예정. (TODO: dev 환경 구축 시 IS_DEV_ENV 부활)
// ════════════════════════════════════════
const _host = location.hostname;

const SUPABASE_URL = 'https://fokuojmzhttxfkmiutmf.supabase.co';   // word-master (운영)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZva3Vvam16aHR0eGZrbWl1dG1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MDYwOTksImV4cCI6MjA5MzM4MjA5OX0.FuYv59ufKteXKusvAhJktBNWntMnWmxctQoHquaPKVA';
console.log('[supabase] env: PROD (word-master) @', _host);

// 로드할 회차 — URL 파라미터로 동적 지정 가능 (테스트 편의):
//   ?area=biology&round=1   → 생물 1회차
//   ?round=2                → 현재 영역 그대로, 2회차
//   파라미터 없으면 default(생물 1회차)
const _params = new URLSearchParams(location.search);
const TARGET_AREA_SLUG = _params.get('area') || 'biology';
const TARGET_ROUND_NO  = parseInt(_params.get('round'), 10) || 1;
const TARGET_LEVEL     = _params.get('level') || '초등';   // 학제: 초등 | 중등


// ════════════════════════════════════════
// SESSION_READY — inline script가 await할 Promise
// ════════════════════════════════════════
// 글로벌 Supabase 클라이언트 — 다른 곳(예: classify_word_input RPC)에서 재사용
window.SUPABASE_CLIENT = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

window.SESSION_READY = (async function loadSession() {
  // Supabase 클라이언트 — 위에서 생성한 전역 인스턴스 사용
  const client = window.SUPABASE_CLIENT;

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
      .eq('level', TARGET_LEVEL)
      .single();
    if (e2) throw e2;

    // 2b. 主字 콘텐츠 — 정규화된 main_chars에서 읽음 (SSOT: 한 곳에서 고치면 전 회차 반영)
    const { data: mc, error: e2b } = await client
      .from('main_chars')
      .select('char_hangul, hun_short, eum, etymology, meanings')
      .eq('char', sess.main_char)
      .single();
    if (e2b) throw e2b;

    // 3. 회차 어휘 (view 활용 — 한 번에 통합 조회)
    const { data: wordRows, error: e3 } = await client
      .from('v_session_word_full')
      .select('word, hanja, char1, hun1, char2, hun2, meaning, fill_sentence, choices, order_in_session')
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
      level: TARGET_LEVEL,
      area: areaRow.name_ko,
      mainChar: sess.main_char,
      mainHun:  mc.hun_short,
      mainHunFull: mc.char_hangul,
      mainEum:  mc.eum,
      mainEtymology: mc.etymology,
      mainMeanings:  mc.meanings || [],

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
          fillSentence: r.fill_sentence,
          // sentenceText/Choices는 현재 스키마에 없음 (필요 시 컬럼 추가)
          sentenceText: null,
          sentenceChoices: null
        };
      }),

      wrongAnswers: (wrongs || []).map(function(w) {
        return { word: w.word, feedback: w.feedback };
      }),

      // nextPreview — 아래에서 다음 회차(round+1) 조회로 채움 (내일의 한자)
      nextPreview: null
    };

    // 다음 회차 미리보기 (내일의 한자) — 같은 영역 round+1. 없으면 null 유지.
    try {
      const { data: nextSess } = await client
        .from('sessions')
        .select('main_char')
        .eq('area_id', areaRow.id)
        .eq('round_no', TARGET_ROUND_NO + 1)
        .eq('level', TARGET_LEVEL)
        .single();
      if (nextSess) {
        const { data: nmc } = await client
          .from('main_chars')
          .select('char_hangul, etymology')
          .eq('char', nextSess.main_char)
          .single();
        window.SESSION.nextPreview = {
          char:      nextSess.main_char,
          hunFull:   nmc ? nmc.char_hangul : null,
          etymology: nmc ? nmc.etymology : null
        };
      }
    } catch (e) { /* 다음 회차 미존재 — nextPreview null 유지 */ }

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
