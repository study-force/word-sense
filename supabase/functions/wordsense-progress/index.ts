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
  if (!['load', 'save', 'clear'].includes(b.action)) return err(400, 'action은 load/save/clear 중 하나', cors);
  if (!b.ticket) return err(400, '입장권이 필요합니다', cors);
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

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

function ok(data: any, cors: Record<string, string>) {
  return new Response(JSON.stringify({ success: true, ...data }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function err(status: number, message: string, cors: Record<string, string>, code?: string) {
  return new Response(JSON.stringify({ success: false, status, message, code: code || null }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
