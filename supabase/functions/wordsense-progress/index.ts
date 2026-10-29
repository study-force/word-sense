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
  if (!['load', 'save', 'clear', 'list'].includes(b.action)) return err(400, 'action은 load/save/clear/list 중 하나', cors);
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  if (b.action === 'list') return list(db, b, cors);
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
function progressText(st: any): string {
  const n = (st?.S?.found || []).length + (st?.S?.recall2 || []).length;
  if (st.phase === 'fill' && st.fq) { const t = (st.fq.words || []).length; return '강화하기 ' + Math.min((st.fq.idx || 0) + 1, t) + ' / ' + t; }
  if (st.phase === 'learn' && st.learn) { const t = (st.learn.words || []).length; return '확장하기 ' + Math.min((st.learn.idx || 0) + 1, t) + ' / ' + t; }
  if (st.phase === 'recall2') return '다시 인출하기 · 떠올린 어휘 ' + n + '개';
  return '인출하기 · 찾은 어휘 ' + n + '개';
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
    // 학원에 완료 보고된 회차인지 = 그 회차 훈련 기록(attempts)이 있는지
    const { data: sess } = await db.from('sessions').select('id, level, area_id, round_no')
      .in('area_id', [...new Set(rows.map((r: any) => r.area_id))]).in('round_no', [...new Set(rows.map((r: any) => r.round_no))]);
    const sid = (r: any) => (sess || []).find((s: any) => s.level === r.level && s.area_id === r.area_id && s.round_no === r.round_no)?.id;
    const ids = rows.map(sid).filter(Boolean);
    const { data: att } = ids.length ? await db.from('attempts').select('session_id').eq('member_no', userNo).in('session_id', ids) : { data: [] };
    const done = new Set((att || []).map((a: any) => a.session_id));
    const items = rows.filter((r: any) => AREA_SLUGS[r.area_id] && r.state?.S).map((r: any) => {
      const completed = done.has(sid(r));
      return {
        training_level: r.level === '중등' ? 'middle' : 'elementary',
        training_area: AREA_SLUGS[r.area_id],
        training_round: r.round_no,
        completed,                                     // true = 결과 화면 뒤 '남은 어휘 재도전' 중 멈춤
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

function ok(data: any, cors: Record<string, string>) {
  return new Response(JSON.stringify({ success: true, ...data }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function err(status: number, message: string, cors: Record<string, string>, code?: string) {
  return new Response(JSON.stringify({ success: false, status, message, code: code || null }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
