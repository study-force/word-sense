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

// ── 테섭/실섭 분기 (2026-10-15) ──
//   테섭 word.sfos.kr · localhost → 테스트 DB(word-master-dev)
//   그 외(실섭 word.sfcenter.co.kr 등)  → 운영 DB(word-master)
//   ※ 테스트 DB 정보(DEV_*)가 비어 있으면 운영 DB를 그대로 씀 (테스트 DB 준비 전 안전장치)
const PROD_SUPABASE_URL = 'https://fokuojmzhttxfkmiutmf.supabase.co';   // word-master (운영)
const PROD_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZva3Vvam16aHR0eGZrbWl1dG1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MDYwOTksImV4cCI6MjA5MzM4MjA5OX0.FuYv59ufKteXKusvAhJktBNWntMnWmxctQoHquaPKVA';
const DEV_SUPABASE_URL = '';        // word-master-dev — 테스트 DB 준비 후 채움
const DEV_SUPABASE_ANON_KEY = '';
const IS_TEST_HOST = _host === 'word.sfos.kr' || _host === 'localhost' || _host === '127.0.0.1';
const USE_DEV = IS_TEST_HOST && !!DEV_SUPABASE_URL && !!DEV_SUPABASE_ANON_KEY;
const SUPABASE_URL = USE_DEV ? DEV_SUPABASE_URL : PROD_SUPABASE_URL;
const SUPABASE_ANON_KEY = USE_DEV ? DEV_SUPABASE_ANON_KEY : PROD_SUPABASE_ANON_KEY;
console.log('[supabase] env:', USE_DEV ? 'DEV (word-master-dev)' : 'PROD (word-master)', '@', _host);

// 로드할 회차 — URL 파라미터로 동적 지정 가능 (테스트 편의):
//   ?area=biology&round=1   → 생물 1회차
//   ?round=2                → 현재 영역 그대로, 2회차
//   파라미터 없으면 default(생물 1회차)
const _params = new URLSearchParams(location.search);
let TARGET_AREA_SLUG = _params.get('area') || 'biology';
let TARGET_ROUND_NO  = parseInt(_params.get('round'), 10) || 1;
let TARGET_LEVEL     = _params.get('level') || '초등';   // 학제: 초등 | 중등
// 학원 시스템 진입(?st=입장권)이면 위 주소 값 대신 입장권에 저장된 영역·회차·과정을 씀 (아래 loadSession 0단계)


// ════════════════════════════════════════
// SESSION_READY — inline script가 await할 Promise
// ════════════════════════════════════════
// 글로벌 Supabase 클라이언트 — 다른 곳(예: classify_word_input RPC)에서 재사용
window.SUPABASE_CLIENT = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// Edge Function 호출(wordsense-session / wordsense-complete)에서 사용 — const는 window에 안 붙어
// 기존엔 window.SUPABASE_URL/ANON_KEY가 undefined라 외부 연동 fetch가 끊겨 있었음(→ 데모 모드 fallback).
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

// 골디락스 오답 선정 (어드민 lib/synonyms.js와 같은 기준) — 뜻 2-gram 자카드
//   덜 헷갈리는 쪽 우선 — 아래 _goldRank 참고. 같은 낱말·같은 뜻 문장은 제외
function _bigrams(x){ const s = String(x || '').replace(/s+/g, ''); const g = new Set(); if (s.length <= 1) { if (s) g.add(s); return g; } for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; }
function _jaccard(a, b){ const s1 = _bigrams(a), s2 = _bigrams(b); if (!s1.size && !s2.size) return 0; let inter = 0; s1.forEach(function(x){ if (s2.has(x)) inter++; }); const uni = new Set([...s1, ...s2]).size; return uni ? inter / uni : 0; }
// 덜 헷갈리게 (대표님 2026-10-15): 0.05~0.15 > 0~0.05 > 0.15~0.25 > 0 > 0.25~0.35(후보 없을 때만), 0.35 이상 제외
function _goldRank(j){ return j >= 0.05 && j < 0.15 ? 0 : j > 0 && j < 0.05 ? 1 : j >= 0.15 && j < 0.25 ? 2 : j === 0 ? 3 : 4; }
function regenChoicesGoldilocks(rows){
  rows.forEach(function(r){
    if (!r._regenChoices) return;
    const pool = rows.filter(function(c){ return c !== r && c.word !== r.word && String(c.meaning).trim() !== String(r.meaning).trim(); })
      .map(function(c){ return { c: c, j: _jaccard(c.meaning, r.meaning) }; })
      .filter(function(x){ return x.j < 0.35; })
      .sort(function(a, b){ return _goldRank(a.j) - _goldRank(b.j) || Math.abs(a.j - 0.1) - Math.abs(b.j - 0.1) || String(a.c.word).localeCompare(String(b.c.word)); });
    const pick = [];
    pool.forEach(function(x){
      if (pick.length >= 3) return;
      if (pick.some(function(y){ return y.c.word === x.c.word || String(y.c.meaning).trim() === String(x.c.meaning).trim(); })) return;
      pick.push(x);
    });
    if (pick.length < 3) return;   // 후보 부족하면 원래 보기 유지
    r.choices = [{ text: r.meaning, is_correct: true }].concat(pick.map(function(x){ return { text: x.c.meaning, is_correct: false }; }));
  });
}

window.SESSION_READY = (async function loadSession() {
  // Supabase 클라이언트 — 위에서 생성한 전역 인스턴스 사용
  const client = window.SUPABASE_CLIENT;

  try {
    // 0. 학원 진입(?st) — 입장권으로 학생·영역·회차 조회 (학생이 주소를 바꿔 다른 회차로 가는 것 방지)
    const st = _params.get('st');
    if (st) {
      try {
        const sr = await fetch(SUPABASE_URL + '/functions/v1/wordsense-session?id=' + encodeURIComponent(st), { headers: { apikey: SUPABASE_ANON_KEY } });
        const sd = sr.ok ? await sr.json() : null;
        if (sd && sd.success) {
          window.__ST_SESSION = sd;   // word-sense.html의 loadStudentFromSession이 다시 부르지 않고 재사용
          if (sd.session.training_area) TARGET_AREA_SLUG = sd.session.training_area;
          if (sd.session.training_round) TARGET_ROUND_NO = Number(sd.session.training_round);
          if (sd.session.training_level) TARGET_LEVEL = sd.session.training_level;
        } else {
          console.warn('[supabase] 입장권 조회 실패 — 만료되었거나 잘못된 입장권', sr.status);
        }
      } catch (e) { console.warn('[supabase] 입장권 조회 오류', e); }
    }

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
      .select('char_hangul, eum, etymology, meanings, narration_url')
      .eq('char', sess.main_char)
      .single();
    if (e2b) throw e2b;

    // 3. 회차 어휘 (view 활용 — 한 번에 통합 조회)
    let { data: wordRows, error: e3 } = await client
      .from('v_session_word_full')
      .select('session_word_id, word_master_id, word, hanja, char1, hun1, char2, hun2, meaning, fill_sentence, choices, order_in_session, grade')
      .eq('session_id', sess.id)
      .order('order_in_session');
    if (e3) throw e3;

    // 3b. 중등 = 초등 누적 — 같은 主字의 초등 회차 어휘도 합침 (중등 어휘 뒤에, word+hanja 중복 제외)
    //     DB 복사 없이 읽을 때 합치므로 초등 어휘를 고치면 중등에도 그대로 반영됨
    // 3b. 중등 = 초등 누적 — 主字가 들어간 초등 어휘를 모두 합침 (대표님 2026-10-15 확장)
    //     우선순위: 같은 主字 초등 회차 어휘 → 그 외 主字가 들어간 초등 어휘. word+hanja 중복 제외.
    //     DB 복사 없이 읽을 때 합치므로 초등 어휘를 고치면 중등에도 그대로 반영됨
    let elemIds = [];
    if (TARGET_LEVEL === '중등') {
      const { data: elemSess, error: e3a } = await client
        .from('sessions')
        .select('id, main_char')
        .eq('level', '초등');
      if (e3a) throw e3a;
      const elemSet = {}, sameChar = {};
      (elemSess || []).forEach(function(s){ elemSet[s.id] = true; if (s.main_char === sess.main_char) sameChar[s.id] = true; });
      elemIds = Object.keys(sameChar).map(Number);   // 오답 피드백은 같은 主字 회차 것만
      const { data: elemRows, error: e3b } = await client
        .from('v_session_word_full')
        .select('session_id, session_word_id, word_master_id, word, hanja, char1, hun1, char2, hun2, meaning, fill_sentence, choices, order_in_session, grade')
        .like('hanja', '%' + sess.main_char + '%')
        .order('session_id')
        .order('order_in_session');
      if (e3b) throw e3b;
      const cand = (elemRows || []).filter(function(r){ return elemSet[r.session_id]; });
      cand.sort(function(a, b){ return (sameChar[b.session_id] ? 1 : 0) - (sameChar[a.session_id] ? 1 : 0); });   // 같은 主字 회차 먼저 (안정 정렬)
      const seen = {};
      wordRows.forEach(function(r){ seen[r.word + '|' + r.hanja] = true; });
      cand.forEach(function(r){
        const k = r.word + '|' + r.hanja;
        if (seen[k]) return;
        seen[k] = true;
        // 다른 主字 초등 회차에서 온 어휘는 원래 보기(그 회차 어휘 뜻)가 이 회차와 안 맞음
        //   예) 未 회차의 미달 ← 達 회차 보기(달성·도달 = 정반대 뜻) → 아래에서 이 회차 어휘로 다시 고름
        if (!sameChar[r.session_id]) r._regenChoices = true;
        wordRows.push(r);
      });
      regenChoicesGoldilocks(wordRows);
    }

    // 3c. 민감 어휘(word_master.sensitive, 대표님 2026-10-15)
    //   slur(비하어): 학습 대상 제외 / body·adult: 초등은 제외, 중등은 입력 시 '이 어휘도 알고 있군요' 피드백만(정답·점수 X)
    let bonusRows = [];
    if (wordRows.length) {
      const ids = wordRows.map(function(r){ return r.word_master_id; });
      const { data: sens } = await client.from('word_master').select('id, sensitive').in('id', ids).not('sensitive', 'is', null);
      const flag = {};
      (sens || []).forEach(function(s){ flag[s.id] = s.sensitive; });
      wordRows = wordRows.filter(function(r){
        const f = flag[r.word_master_id];
        if (!f) return true;
        if (f !== 'slur' && TARGET_LEVEL === '중등') bonusRows.push(r);
        return false;
      });
    }

    // 3d. 보기 문구 SSOT — 각 보기는 어휘 사전(word_master) 연결(entry_id)을 가지며,
    //     화면에는 저장된 문구 대신 '지금 어휘 사전의 뜻'을 보여준다 (뜻을 고치면 모든 보기가 자동 반영, 2026-10-15)
    {
      const eids = {};
      wordRows.forEach(function(r){ (r.choices || []).forEach(function(c){ if (c && c.entry_id != null) eids[c.entry_id] = true; }); });
      const idList = Object.keys(eids).map(Number);
      if (idList.length) {
        const { data: ms } = await client.from('word_master').select('id, meaning').in('id', idList);
        const M = {};
        (ms || []).forEach(function(m){ M[m.id] = m.meaning; });
        wordRows.forEach(function(r){
          if (!Array.isArray(r.choices)) return;
          r.choices = r.choices.map(function(c){ return (c && c.entry_id != null && M[c.entry_id]) ? Object.assign({}, c, { text: M[c.entry_id] }) : c; });
        });
      }
    }

    // 4. 회차 오답 피드백
    const { data: wrongs, error: e4 } = await client
      .from('wrong_words')
      .select('word, feedback')
      .in('session_id', [sess.id].concat(elemIds));   // 중등이면 초등 같은 主字 회차 오답 피드백도
    if (e4) throw e4;

    // 5. data.js의 SESSION 형식으로 변환
    window.SESSION = {
      id: sess.round_no,
      dbId: sess.id,          // DB sessions.id — 결과 저장(attempts.session_id)용
      areaId: areaRow.id,     // areas.id — attempts.area_id용
      level: TARGET_LEVEL,
      area: areaRow.name_ko,
      mainChar: sess.main_char,
      mainHunFull: mc.char_hangul,
      mainEum:  mc.eum,
      mainEtymology: mc.etymology,
      mainMeanings:  mc.meanings || [],
      narrationUrl:  mc.narration_url || null,   // 어원 나레이션 (Storage 공개 URL)

      // DB choices: [{text, is_correct}, ...] → 앱 형식: [정답, 오답1, 오답2, 오답3]
      words: wordRows.map(function(r) {
        const correct = (r.choices || []).find(function(c){ return c.is_correct; });
        const wrongChoices = (r.choices || []).filter(function(c){ return !c.is_correct; });
        return {
          swId: r.session_word_id,      // 결과 저장(word_results)용
          wmId: r.word_master_id,
          grade: r.grade,
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

      // 민감 어휘(중등) — 직접 입력하면 '알고 있군요' 피드백만 (정답·점수·퀴즈·힌트·확장·강화·분모 제외)
      bonusWords: bonusRows.map(function(r){ return { word: r.word, hanja: r.hanja, meaning: r.meaning, wmId: r.word_master_id, char1: r.char1, hun1: r.hun1, char2: r.char2, hun2: r.hun2 }; }),

      wrongAnswers: (wrongs || []).map(function(w) {
        return { word: w.word, feedback: w.feedback };
      }),

      // nextPreview — 아래에서 다음 회차(round+1) 조회로 채움 (내일의 한자)
      nextPreview: null
    };

    // 영역 전체 회차 main_chars — 훈사전 그리드용 (영역마다 다른 50글자)
    // 훈음은 SSOT인 main_chars에서 읽음 (sessions.main_char_hangul 복사본 미사용 — 레슨 화면과 동일 출처)
    try {
      const { data: areaSessions } = await client
        .from('sessions')
        .select('round_no, main_char')
        .eq('area_id', areaRow.id)
        .eq('level', TARGET_LEVEL)
        .order('round_no');
      const areaChars2 = areaSessions || [];
      const charSet = {};
      areaChars2.forEach(function(s) { if (s.main_char) charSet[s.main_char] = 1; });
      const uniqChars = Object.keys(charSet);
      const hunMap = {};
      if (uniqChars.length) {
        const { data: mcs } = await client
          .from('main_chars')
          .select('char, char_hangul')
          .in('char', uniqChars);
        (mcs || []).forEach(function(m) { hunMap[m.char] = m.char_hangul || ''; });
      }
      window.SESSION.areaChars = areaChars2.map(function(s) {
        return { round: s.round_no, char: s.main_char, hun: hunMap[s.main_char] || '' };
      });
    } catch (e) { window.SESSION.areaChars = []; }

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
