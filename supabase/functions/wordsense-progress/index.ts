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
// ════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TICKET_MS = 12 * 3600 * 1000;        // 입장권을 연 뒤 12시간까지 저장 가능 (긴 훈련 대비)
const KEEP_MS = 30 * 24 * 3600 * 1000;     // 30일 지난 진행 상황은 이어하지 않음
const MAX_BYTES = 200 * 1024;              // 한 번에 저장할 수 있는 크기 (보통 수 KB)

function safeHost(url: string) { try { return new URL(url).hostname; } catch { return ''; } }
function corsHeaders(origin: string | null): Record<string, string> {
  const h = origin ? safeHost(origin) : '';
  const ok = !!h && (/\.sfcenter\.co\.kr$/.test(h) || /\.sfos\.kr$/.test(h) || h === 'localhost' || h === '127.0.0.1');
  return {
    'Access-Control-Allow-Origin': ok ? origin! : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization',
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
  if (b.action === 'rounds') return rounds(db, b, cors);
  if (!b.ticket) return err(400, '입장권이 필요합니다', cors);

  try {
    // ── 학생·회차 확인 (입장권) ──
    const { data: t } = await db.from('session_init')
      .select('user_no, used_at, created_at, training_mode, training_level, training_area, training_round')
      .eq('id', b.ticket).maybeSingle();
    if (!t || !t.user_no) return err(403, '입장권을 확인할 수 없습니다', cors);
    if (t.training_mode === 'report') return err(403, '훈련 입장권이 아닙니다', cors);
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
async function rounds(db: any, b: any, cors: Record<string, string>) {
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
