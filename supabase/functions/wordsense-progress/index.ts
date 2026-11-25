// ════════════════════════════════════════════════════════════════
// Edge Function: wordsense-progress — 훈련 이어하기 (대표님 2026-10-29)
//
//   훈련 중간 상태를 서버(training_progress)에 저장 → 브라우저·기기를 바꿔도 하던 지점부터 이어서
//   학생 확인: 학원 입장권(session_init.id) → 회원번호·과정·영역·회차는 서버가 입장권에서 읽음 (브라우저 값은 안 믿음)
//   기준 = 회원 + 과정 + 영역 + 회차 — 학원이 새 입장권으로 같은 회차를 열어도 같은 진행 상황
//
// 입력 (POST JSON): { action, ticket, state? }
//   load  → { state, updated_at } (없거나 30일 지난 것은 null)
//   save  { state } → 덮어쓰기
//   clear → 지움 (회차를 끝까지 마쳤거나 '처음부터'를 골랐을 때)
//   list  { user_no, training_level? } → { items[] } 학원 달력 [이어하기]용 — 입장권 없이 (아래 list 참고)
//   rounds { user_no, training_level, training_area } → { items[], unit_tests[] } 마이룸 회차별 현황 — 입장권 없이
//          { user_nos[] 또는 targets[] } → { students{} } 여러 학생 한 번에 (2026-11-25, 아래 rounds 참고)
// ════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TICKET_MS = 12 * 3600 * 1000;        // 입장권을 연 뒤 12시간까지 저장 가능 (긴 훈련 대비)
const KEEP_MS = 30 * 24 * 3600 * 1000;     // 30일 지난 진행 상황은 이어하지 않음
const MAX_BYTES = 200 * 1024;              // 한 번에 저장할 수 있는 크기 (보통 수 KB)
const BATCH_MAX = 60;                      // rounds 여러 학생 조회 — 한 번에 받을 수 있는 (학생·과정·영역) 묶음 수
// (선택) 여러 학생 조회 전용 열쇠 — 이 값을 Supabase secrets에 넣으면, 여러 학생 조회는 x-center-key 헤더가 같을 때만 답함.
//   넣지 않으면 지금처럼 열쇠 없이 답함. 학생 한 명 조회(마이룸)는 이 값과 상관없이 지금과 같음.
const CENTER_BATCH_KEY = Deno.env.get('CENTER_BATCH_KEY') || '';

function safeHost(url: string) { try { return new URL(url).hostname; } catch { return ''; } }
function corsHeaders(origin: string | null): Record<string, string> {
  const h = origin ? safeHost(origin) : '';
  const ok = !!h && (/\.sfcenter\.co\.kr$/.test(h) || /\.sfos\.kr$/.test(h) || h === 'localhost' || h === '127.0.0.1');
  return {
    'Access-Control-Allow-Origin': ok ? origin! : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization, x-center-key',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return err(405, 'Method not allowed', cors);
  let b: any;
  try { b = await req.json(); } catch { return err(400, '입력 JSON 파싱 실패', cors); }
  if (!['load', 'save', 'clear', 'list', 'rounds'].includes(b.action)) return err(400, 'action은 load/save/clear/list/rounds 중 하나', cors);
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  if (b.action === 'list') return list(db, b, cors);
  if (b.action === 'rounds') return rounds(db, b, cors, req);
  if (!b.ticket) return err(400, '입장권이 필요합니다', cors);

  try {
    // ── 학생·회차 확인 (입장권) ──
    const { data: t } = await db.from('session_init')
      .select('user_no, used_at, created_at, training_mode, training_level, training_area, training_round')
      .eq('id', b.ticket).maybeSingle();
    if (!t || !t.user_no) return err(403, '입장권을 확인할 수 없습니다', cors);
    if (t.training_mode === 'report' || t.training_mode === 'review') return err(403, '훈련 입장권이 아닙니다', cors);   // 복습은 이어하기 저장 없음
    if (Date.now() - new Date(t.used_at || t.created_at).getTime() > TICKET_MS) return err(403, '입장권 시간이 지났습니다', cors);
    if (!t.training_area || !t.training_round) return err(400, '입장권에 영역·회차가 없습니다', cors);
    const { data: area } = await db.from('areas').select('id').eq('slug', t.training_area).maybeSingle();
    if (!area) return err(400, '영역을 찾을 수 없습니다', cors);
    const key = { member_no: Number(t.user_no), level: t.training_level || '초등', area_id: area.id, round_no: Number(t.training_round) };
    const match = (q: any) => q.eq('member_no', key.member_no).eq('level', key.level).eq('area_id', key.area_id).eq('round_no', key.round_no);

    if (b.action === 'load') {
      const { data: row, error } = await match(db.from('training_progress').select('state, updated_at')).maybeSingle();
      if (error) throw error;
      if (!row || Date.now() - new Date(row.updated_at).getTime() > KEEP_MS) return ok({ state: null }, cors);
      return ok({ state: row.state, updated_at: row.updated_at }, cors);
    }
    if (b.action === 'save') {
      if (!b.state || typeof b.state !== 'object') return err(400, 'state가 필요합니다', cors);
      if (JSON.stringify(b.state).length > MAX_BYTES) return err(413, '저장할 내용이 너무 큽니다', cors);
      const { error } = await db.from('training_progress').upsert({ ...key, state: b.state, updated_at: new Date().toISOString() });
      if (error) throw error;
      return ok({}, cors);
    }
    // clear
    const { error } = await match(db.from('training_progress').delete());
    if (error) throw error;
    return ok({}, cors);
  } catch (e) {
    console.error('[wordsense-progress]', e);
    return err(500, '서버 오류: ' + (e as Error).message, cors);
  }
});

// ── list: 학원 달력 아래 목록의 [이어하기] 버튼용 — 이 학생이 하다 만 회차들 (대표님 2026-10-29) ──
//   입력 { action:'list', user_no, training_level? (elementary/middle 또는 초등/중등, 없으면 둘 다) }
//   completed = 학원에 이미 완료 보고된 회차(결과 화면 뒤 '남은 어휘 재도전' 중 멈춤) → training_mode "retry"로 입장
//               아니면 결과 화면 전에 멈춘 회차 → 평소처럼(normal) 입장
const AREA_SLUGS: Record<number, string> = {};
const STAGE_LABEL: Record<string, string> = { retrieve: '인출하기', learn: '확장하기', recall2: '다시 인출하기', fill: '강화하기' };
// 진행 문구 (2026-11-02) — 단계 시작 저장은 '○○ 처음부터', [저장하고 끝내기]로 저장한 자리는 몇 번째까지
function progressText(st: any): string {
  if (!st?.exact) return (STAGE_LABEL[st?.phase] || '인출하기') + ' 처음부터';
  // [저장하고 끝내기]로 저장한 자리
  if (st.phase === 'fill' && st.fq) { const t = (st.fq.words || []).length; return '강화하기 ' + Math.min((st.fq.idx || 0) + 1, t) + ' / ' + t; }
  if (st.phase === 'learn' && st.learn) { const t = (st.learn.words || []).length; return '확장하기 ' + Math.min((st.learn.idx || 0) + 1, t) + ' / ' + t; }
  if (st.phase === 'recall2') return '다시 인출하기 · 떠올린 어휘 ' + (st.S?.recall2 || []).length + '개';
  return '인출하기 · 찾은 어휘 ' + (st.S?.found || []).length + '개';
}
// 학원에 완료(엔드데이트)를 보낸 회차 = 그 회차 평소 입장권이 완료 처리됨 (2026-11-02)
//   완료는 학생이 결과 화면에서 '나의 훈사전'으로 들어갈 때 보냄 → 결과만 보고 닫았거나 '남은 어휘 재도전' 중 멈춘 회차는 아직 미완료
//   열쇠: '과정|영역|회차' (과정=초등/중등, 영역=slug)
async function academyDoneKeys(db: any, userNo: number): Promise<Set<string>> {
  const { data } = await db.from('session_init').select('training_level, training_area, training_round')
    .eq('user_no', userNo).neq('training_mode', 'report').not('completed_at', 'is', null);
  return new Set((data || []).map((x: any) => (x.training_level || '초등') + '|' + x.training_area + '|' + Number(x.training_round)));
}

async function list(db: any, b: any, cors: Record<string, string>) {
  const userNo = Number(b.user_no);
  if (!Number.isFinite(userNo)) return err(400, 'user_no가 필요합니다', cors);
  const lvRaw = String(b.training_level ?? '').trim().toLowerCase();
  const level = lvRaw === 'middle' || lvRaw === '중등' ? '중등' : lvRaw === 'elementary' || lvRaw === '초등' ? '초등' : null;
  try {
    let q = db.from('training_progress').select('level, area_id, round_no, state, updated_at')
      .eq('member_no', userNo).gte('updated_at', new Date(Date.now() - KEEP_MS).toISOString())
      .order('updated_at', { ascending: false });
    if (level) q = q.eq('level', level);
    const { data: rows, error } = await q;
    if (error) throw error;
    if (!rows || !rows.length) return ok({ items: [] }, cors);
    if (!Object.keys(AREA_SLUGS).length) {
      const { data: areas } = await db.from('areas').select('id, slug');
      (areas || []).forEach((a: any) => { AREA_SLUGS[a.id] = a.slug; });
    }
    const { data: sess } = await db.from('sessions').select('id, level, area_id, round_no, main_char')
      .in('area_id', [...new Set(rows.map((r: any) => r.area_id))]).in('round_no', [...new Set(rows.map((r: any) => r.round_no))]);
    const sessOf = (r: any) => (sess || []).find((s: any) => s.level === r.level && s.area_id === r.area_id && s.round_no === r.round_no);
    const sid = (r: any) => sessOf(r)?.id;
    // 회차 한자 훈음 — 앱과 같은 main_chars(한 곳에서 관리)에서
    const chars = [...new Set((sess || []).map((x: any) => x.main_char).filter(Boolean))];
    const { data: mcs } = chars.length ? await db.from('main_chars').select('char, char_hangul').in('char', chars) : { data: [] };
    const hunOf = (c: string) => (mcs || []).find((m: any) => m.char === c)?.char_hangul || null;
    const done = await academyDoneKeys(db, userNo);
    const items = rows.filter((r: any) => AREA_SLUGS[r.area_id] && r.state?.S).map((r: any) => {
      const completed = done.has(r.level + '|' + AREA_SLUGS[r.area_id] + '|' + r.round_no);
      return {
        training_level: r.level === '중등' ? 'middle' : 'elementary',
        training_area: AREA_SLUGS[r.area_id],
        training_round: r.round_no,
        main_char: sessOf(r)?.main_char || null,         // 회차 한자 (예: 氣) — 학원이 따로 알 필요 없게 함께 보냄
        main_hun: hunOf(sessOf(r)?.main_char),           // 훈음 (예: 기운 기)
        completed,                                     // true = 학원 완료(엔드데이트) 뒤 학원 [재도전]으로 하다 멈춤
        training_mode: completed ? 'retry' : 'normal', // [이어하기] 누를 때 wordsense-start에 보낼 값
        stage: r.state.phase || 'retrieve',
        stage_label: STAGE_LABEL[r.state.phase] || '인출하기',
        progress_text: progressText(r.state),          // 예) '강화하기 7 / 20'
        updated_at: r.updated_at,
      };
    });
    return ok({ items }, cors);
  } catch (e) {
    console.error('[wordsense-progress list]', e);
    return err(500, '서버 오류: ' + (e as Error).message, cors);
  }
}

// ── rounds: 학원 마이룸 달력 아래 목록용 '회차별 현황' (대표님 2026-11-02) ──
//   입력 { action:'rounds', user_no, training_level(elementary/middle 또는 초등/중등), training_area(biology…) }
//   훈련한 회차 + 하다 만 회차마다: 한자·훈음, 전체/획득/미획득 어휘 수, 재도전 횟수, 상태, 이어하기 정보
//   획득 = 학생 화면의 '획득'과 같은 기준(인출·다시 인출 + 강화 통과, 과정 누적) — 훈사전·결과지와 같은 집계
//
// ── 2026-11-25 (성효민 대리 요청) ──
//   ① 툴팁 숫자 추가 — 회차마다 첫 훈련의 인출·확장·강화(획득/전체), 시작·종료 시각 + 실력 점검(unit_tests) 점수
//      예전 칸은 이름·뜻 그대로, 새 칸만 덧붙임. 실력 점검은 items에 섞지 않고 unit_tests에 따로 담음
//      (items를 '회차'로 보고 그리는 기존 화면이 실력 점검 줄을 회차로 잘못 그리지 않게)
//   ② 여러 학생 한 번에 — { user_nos:[…], training_level, training_area } 또는 { targets:[{ user_no, training_level, training_area }, …] }
//      → { students: { "회원번호": [ { training_level, training_area, items, unit_tests } ] } }  (한 번에 BATCH_MAX 묶음까지)
//   계산은 DB 함수 wordsense_rounds_batch 한 번으로 끝냄(학생 수와 상관없이 조회 2번).
//   그 함수가 아직 없는 DB에서는 학생 한 명 조회만 예전 방식(roundsLegacy)으로 답함 — 새 칸·unit_tests 없이 2026-11-02 응답 그대로.
const AREA_IDS: Record<string, number> = {};
async function areaIdOf(db: any, slug: string): Promise<number | null> {
  if (!Object.keys(AREA_IDS).length) {
    const { data: areas } = await db.from('areas').select('id, slug');
    (areas || []).forEach((a: any) => { AREA_IDS[a.slug] = a.id; });
  }
  return AREA_IDS[slug] ?? null;
}
const levelOf = (v: any) => { const s = String(v ?? '').trim().toLowerCase(); return s === 'middle' || s === '중등' ? '중등' : '초등'; };
const levelCode = (level: string) => level === '중등' ? 'middle' : 'elementary';
const AREA_ERR = 'training_area는 biology/society/history/science/culture/economy 중 하나';

// 이어하기 문구 — progressText와 같은 규칙. DB 함수가 진행 상황에서 필요한 값만 꺼내 준 것으로 만듦
function progressTextLite(p: any): string {
  if (!p?.exact) return (STAGE_LABEL[p?.phase] || '인출하기') + ' 처음부터';
  if (p.phase === 'fill' && p.has_fq) { const t = Number(p.fq_n) || 0; return '강화하기 ' + Math.min((Number(p.fq_idx) || 0) + 1, t) + ' / ' + t; }
  if (p.phase === 'learn' && p.has_learn) { const t = Number(p.learn_n) || 0; return '확장하기 ' + Math.min((Number(p.learn_idx) || 0) + 1, t) + ' / ' + t; }
  if (p.phase === 'recall2') return '다시 인출하기 · 떠올린 어휘 ' + (Number(p.recall2_n) || 0) + '개';
  return '인출하기 · 찾은 어휘 ' + (Number(p.found_n) || 0) + '개';
}
const pairOf = (a: any, t: any) => (a == null || t == null) ? null : { acquired: Number(a), total: Number(t) };

// 회차 한 줄 — 앞쪽은 2026-11-02 칸 그대로, 뒤쪽이 2026-11-25에 덧붙인 칸
function roundItem(r: any) {
  const pg: any = r.prog || null, ft: any = r.first_try || null;
  const fin = !!r.done;                                // 학원 완료(엔드데이트) 보냄
  const total = Number(r.total) || 0, got = Math.min(Number(r.known) || 0, total);
  const tries = Number(r.tries) || 0;
  return {
    training_round: r.round,
    main_char: r.main_char || null,
    main_hun: r.main_hun || null,
    total_words: total,
    acquired: got,
    not_acquired: total - got,
    completed: fin,
    retry_count: Math.max(tries - 1, 0),
    status: !fin ? 'in_progress' : pg ? 'retry_paused' : 'completed',
    can_retry: fin && got < total,
    can_review: fin && got > 0,
    review_words: fin ? got : 0,
    review_count: Number(r.reviews) || 0,
    resume: pg ? {
      training_mode: fin ? 'retry' : 'normal',
      stage_label: STAGE_LABEL[pg.phase] || '인출하기',
      progress_text: progressTextLite(pg),
      updated_at: pg.updated_at,
    } : null,
    // ── 2026-11-25 추가 ──
    is_perfect: total > 0 && got >= total,             // 모든 어휘 획득 (화면의 'perfect')
    passed: tries > 0 && total > 0 && got * 10 >= total * 8,   // 통과 = 회차 어휘의 80% 이상 획득 (실력 점검 자격과 같은 기준)
    // 아래 인출·확장·강화·시각은 이 회차 '첫 훈련' 기준 (재도전은 남은 어휘만 하므로 숫자가 섞이지 않게). 기록이 없으면 null
    retrieve: ft ? pairOf(ft.retr, ft.retr_total) : null,      // 인출: 스스로 떠올린 어휘 / 그날 훈련한 어휘
    expand: ft ? pairOf(ft.exp, ft.exp_total) : null,          // 확장: 확장 뒤 다시 떠올린 어휘 / 인출에서 못 떠올린 어휘
    reinforce: ft ? pairOf(ft.rf, ft.rf_total) : null,         // 강화: 한 번에 맞힌 어휘 / 강화에 나온 어휘 (= 그날 획득)
    stage_source: ft ? ft.src : null,                  // words = 어휘별 기록으로 계산 / summary = 요약 숫자(옛 기록, 강화는 null)
    started_at: ft?.started_at ?? null,                // 첫 훈련 시작 시각
    ended_at: ft?.finished_at ?? null,                 // 첫 훈련 종료 시각 (결과 화면에 닿은 때)
    duration_sec: ft?.duration_sec ?? null,
    last_trained_at: r.last_finished ?? null,          // 가장 최근에 끝까지 한 훈련(재도전 포함)의 종료 시각
    completed_at: r.first_done ?? null,                // 학원 완료(엔드데이트)를 보낸 시각 — 안 보냈으면 null
  };
}
// 실력 점검 한 줄 — 5회차 묶음(1~5회차 = 1차, 6~10회차 = 2차 …)마다. 점수는 가장 높았던 응시 기준
function unitItem(u: any) {
  const unit = Number(u.unit), tries = Number(u.tries) || 0, eligible = (Number(u.passed) || 0) >= 5;
  const nq = Number(u.nq) > 0 ? Number(u.nq) : null;
  const score = u.best ?? null;
  const mastered = nq && u.n_known != null ? Math.round(Number(u.n_known) * 100 / nq) : null;   // 완전 습득 점수 (4점씩)
  return {
    unit,
    round_from: (unit - 1) * 5 + 1,
    round_to: unit * 5,
    after_round: unit * 5,                             // 이 회차 줄 바로 아래에 「실력점검」 줄을 그리면 됨
    trained_rounds: Number(u.trained) || 0,            // 묶음 5회차 중 훈련한 회차 수
    passed_rounds: Number(u.passed) || 0,              // 그중 통과(80% 이상 획득)한 회차 수
    eligible,                                          // 응시 가능 = 5회차 모두 통과
    // done = 본 적 있음 / in_progress = 풀다가 멈춤 / ready = 볼 수 있는데 아직 안 봄 / locked = 아직 못 봄
    status: u.open ? 'in_progress' : tries > 0 ? 'done' : eligible ? 'ready' : 'locked',
    question_count: nq,                                // 문항 수 (본 적 없으면 null — 보통 25문항)
    try_count: tries,                                  // 끝까지 본 횟수
    retry_count: Math.max(tries - 1, 0),               // 반복 횟수 (처음 본 뒤 다시 본 횟수)
    score,                                             // 총 점수 /100 (가장 높았던 응시)
    max_score: 100,
    mastered_count: tries > 0 ? (u.n_known ?? null) : null,     // 완전 습득 = 한글만 보고 맞힘 (문항 수)
    mastered_score: mastered,                                   // 완전 습득 점수
    inferred_count: tries > 0 ? (u.n_hanja ?? null) : null,     // 추론 = 한자를 보고 맞힘 (문항 수)
    inferred_score: score != null && mastered != null ? Math.max(score - mastered, 0) : null,   // 추론 점수 (2점씩)
    wrong_count: tries > 0 ? (Number(u.n_hanja_wrong) || 0) + (Number(u.n_wrong) || 0) : null,
    first_score: u.first ?? null,
    last_score: u.last ?? null,
    started_at: u.started_at ?? null,                  // score를 받은 응시의 시작·종료 시각
    ended_at: u.finished_at ?? null,
  };
}

async function rounds(db: any, b: any, cors: Record<string, string>, req: Request) {
  const batch = Array.isArray(b.targets) || Array.isArray(b.user_nos);
  try {
    // ── 학생 한 명 (마이룸) — 2026-11-02 응답 그대로 + 새 칸 ──
    if (!batch) {
      const userNo = Number(b.user_no);
      if (!Number.isFinite(userNo)) return err(400, 'user_no가 필요합니다', cors);
      const level = levelOf(b.training_level), slug = String(b.training_area || '');
      const areaId = await areaIdOf(db, slug);
      if (!areaId) return err(400, AREA_ERR, cors);
      const { data, error } = await db.rpc('wordsense_rounds_batch', { p_targets: [{ m: userNo, level, area_id: areaId }] });
      if (error) {   // DB 함수가 아직 없는 DB 등 — 예전 방식으로 (새 칸 없이)
        console.warn('[wordsense-progress rounds] 일괄 함수 사용 불가 → 예전 방식', error.message);
        return roundsLegacy(db, b, cors);
      }
      const row = (data || [])[0] || { rounds: [], units: [] };
      return ok({ training_level: levelCode(level), training_area: slug,
        items: (row.rounds || []).map(roundItem), unit_tests: (row.units || []).map(unitItem) }, cors);
    }

    // ── 여러 학생 한 번에 (전체훈련현황) ──
    if (CENTER_BATCH_KEY && req.headers.get('x-center-key') !== CENTER_BATCH_KEY) return err(401, '여러 학생 조회 열쇠(x-center-key)가 맞지 않습니다', cors, 'bad_key');
    const raw: any[] = Array.isArray(b.targets) ? b.targets
      : b.user_nos.map((n: any) => ({ user_no: n, training_level: b.training_level, training_area: b.training_area }));
    const seen = new Set<string>();
    const targets: { m: number; level: string; area_id: number; slug: string }[] = [];
    for (const t of raw) {
      const m = Number(t?.user_no);
      if (!Number.isSafeInteger(m) || m <= 0) return err(400, 'user_no가 숫자가 아닌 항목이 있습니다', cors);
      const level = levelOf(t.training_level ?? b.training_level), slug = String((t.training_area ?? b.training_area) || '');
      const areaId = await areaIdOf(db, slug);
      if (!areaId) return err(400, AREA_ERR, cors);
      const k = m + '|' + level + '|' + areaId;
      if (seen.has(k)) continue;                       // 같은 묶음은 한 번만
      seen.add(k);
      targets.push({ m, level, area_id: areaId, slug });
    }
    if (!targets.length) return ok({ students: {}, count: 0 }, cors);
    if (targets.length > BATCH_MAX) return err(400, `한 번에 ${BATCH_MAX}개까지 조회할 수 있습니다 (받은 수 ${targets.length}) — 나누어 불러 주세요`, cors, 'too_many');
    const { data, error } = await db.rpc('wordsense_rounds_batch', { p_targets: targets.map(({ m, level, area_id }) => ({ m, level, area_id })) });
    if (error) {
      console.error('[wordsense-progress rounds batch]', error);
      return err(503, '여러 학생 조회를 지금 쓸 수 없습니다 — 학생 한 명씩 불러 주세요', cors, 'batch_unavailable');
    }
    const rowOf = new Map<string, any>((data || []).map((r: any) => [r.m + '|' + r.level + '|' + r.area_id, r]));
    const students: Record<string, any[]> = {};
    for (const t of targets) {   // 기록이 없는 학생도 빈 목록으로 넣음 (요청한 학생이 모두 응답에 있게)
      const row = rowOf.get(t.m + '|' + t.level + '|' + t.area_id) || { rounds: [], units: [] };
      (students[String(t.m)] = students[String(t.m)] || []).push({
        training_level: levelCode(t.level), training_area: t.slug,
        items: (row.rounds || []).map(roundItem), unit_tests: (row.units || []).map(unitItem),
      });
    }
    return ok({ students, count: targets.length }, cors);
  } catch (e) {
    console.error('[wordsense-progress rounds]', e);
    return err(500, '서버 오류: ' + (e as Error).message, cors);
  }
}

// ── 예전 방식 (2026-11-02 그대로) — DB 함수 wordsense_rounds_batch 가 없을 때만 씀. 학생 한 명마다 조회 7번 ──
async function roundsLegacy(db: any, b: any, cors: Record<string, string>) {
  const userNo = Number(b.user_no);
  if (!Number.isFinite(userNo)) return err(400, 'user_no가 필요합니다', cors);
  const lvRaw = String(b.training_level ?? '').trim().toLowerCase();
  const level = lvRaw === 'middle' || lvRaw === '중등' ? '중등' : '초등';
  try {
    const { data: area } = await db.from('areas').select('id').eq('slug', String(b.training_area || '')).maybeSingle();
    if (!area) return err(400, 'training_area는 biology/society/history/science/culture/economy 중 하나', cors);
    const [{ data: prog }, { data: sess }, { data: pr }] = await Promise.all([
      db.rpc('wordsense_area_progress', { p_member_no: userNo, p_area_id: area.id, p_level: level }),
      db.from('sessions').select('id, round_no, main_char').eq('area_id', area.id).eq('level', level),
      db.from('training_progress').select('round_no, state, updated_at').eq('member_no', userNo).eq('level', level).eq('area_id', area.id)
        .gte('updated_at', new Date(Date.now() - KEEP_MS).toISOString()),
    ]);
    const byRound = new Map((sess || []).map((x: any) => [x.round_no, x]));
    const ids = (sess || []).map((x: any) => x.id);
    const chars = [...new Set((sess || []).map((x: any) => x.main_char).filter(Boolean))];
    const [{ data: att }, { data: mcs }] = await Promise.all([
      ids.length ? db.from('attempts').select('session_id').eq('member_no', userNo).in('session_id', ids) : Promise.resolve({ data: [] }),
      chars.length ? db.from('main_chars').select('char, char_hangul').in('char', chars) : Promise.resolve({ data: [] }),
    ]);
    const tries = new Map<number, number>();
    (att || []).forEach((a: any) => tries.set(a.session_id, (tries.get(a.session_id) || 0) + 1));
    const hunOf = (c: string) => (mcs || []).find((m: any) => m.char === c)?.char_hangul || null;
    const progOf = new Map((pr || []).filter((r: any) => r.state?.S).map((r: any) => [r.round_no, r]));
    const done = await academyDoneKeys(db, userNo);
    // 복습 횟수 = 복습 입장권을 실제로 연 횟수
    const { data: rv } = await db.from('session_init').select('training_round').eq('user_no', userNo).eq('training_mode', 'review')
      .eq('training_level', level).eq('training_area', b.training_area).not('used_at', 'is', null);
    const reviews = new Map<number, number>();
    (rv || []).forEach((x: any) => reviews.set(Number(x.training_round), (reviews.get(Number(x.training_round)) || 0) + 1));
    const items = (prog || []).filter((p: any) => p.trained || progOf.has(p.round)).map((p: any) => {
      const se: any = byRound.get(p.round) || {};
      const pg: any = progOf.get(p.round);
      const fin = done.has(level + '|' + b.training_area + '|' + p.round);   // 학원 완료(엔드데이트) 보냄
      const total = Number(p.total) || 0, got = Math.min(Number(p.known) || 0, total);
      return {
        training_round: p.round,
        main_char: se.main_char || null,                 // 회차 한자 (예: 氣)
        main_hun: hunOf(se.main_char),                   // 훈음 (예: 기운 기)
        total_words: total,                              // 회차 전체 어휘
        acquired: got,                                   // 획득 어휘
        not_acquired: total - got,                       // 미획득 어휘
        completed: fin,                                  // 훈련완료 = 학원에 엔드데이트 보냄 (학생이 '나의 훈사전'까지 들어감)
        retry_count: Math.max((tries.get(se.id) || 0) - 1, 0),   // 재도전 횟수 (첫 완료 뒤 다시 끝까지 한 횟수)
        // completed = 끝남 / in_progress = 학원 미완료(훈련 중 멈춤·남은 어휘 재도전 중 멈춤·결과만 보고 닫음 → 달력 ▶로 같은 회차)
        // retry_paused = 끝난 회차를 학원 [재도전]으로 하다 멈춤
        status: !fin ? 'in_progress' : pg ? 'retry_paused' : 'completed',
        can_retry: fin && got < total,                   // [재도전] 가능 — 끝난 회차만, 모든 어휘를 획득하면 불가
        can_review: fin && got > 0,                      // [복습] 가능 — 끝난 회차에 획득 어휘가 있으면 (2026-11-02)
        review_words: fin ? got : 0,                     // 복습할 어휘 수 = 획득 어휘 (확장 카드로 다시 떠올리기)
        review_count: reviews.get(p.round) || 0,         // 복습 횟수
        resume: pg ? {                                   // [이어하기] 정보 (없으면 null)
          training_mode: fin ? 'retry' : 'normal',
          stage_label: STAGE_LABEL[pg.state.phase] || '인출하기',
          progress_text: progressText(pg.state),
          updated_at: pg.updated_at,
        } : null,
      };
    });
    return ok({ training_level: level === '중등' ? 'middle' : 'elementary', training_area: b.training_area, items }, cors);
  } catch (e) {
    console.error('[wordsense-progress rounds]', e);
    return err(500, '서버 오류: ' + (e as Error).message, cors);
  }
}

function ok(data: any, cors: Record<string, string>) {
  return new Response(JSON.stringify({ success: true, ...data }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function err(status: number, message: string, cors: Record<string, string>, code?: string) {
  return new Response(JSON.stringify({ success: false, status, message, code: code || null }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
