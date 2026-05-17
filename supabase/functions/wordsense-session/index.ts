// ════════════════════════════════════════════════════════════════
// Edge Function: wordsense-session
//
// 역할: word-sense.html이 ?st={uuid}로 진입했을 때, sessionId로 학생 데이터 조회.
//
// 입력 (GET):
//   ?id={sessionId}
//
// 처리:
//   1) session_init 조회 (expires_at > NOW(), used_at IS NULL)
//   2) students JOIN → 학생 정보
//   3) used_at = NOW() 마크 (1회 사용)
//   4) 응답: { user_no, name, section, school_grade, academy_no, payment_fn, training_round, is_payment }
//
// 호출: word-sense.html에서 fetch
// ════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function corsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin && (
    /\.sfcenter\.co\.kr$/.test(safeHost(origin)) ||
    /\.sfos\.kr$/.test(safeHost(origin)) ||
    safeHost(origin) === 'localhost' ||
    safeHost(origin) === '127.0.0.1'
  );
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin! : '',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function safeHost(url: string) { try { return new URL(url).hostname; } catch { return ''; } }

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'GET') {
    return jsonErr(405, 'Method not allowed', cors);
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get('id');
  if (!sessionId) {
    return jsonErr(400, 'sessionId 누락', cors);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  // ── 세션 조회 (만료 X, 미사용) ──
  const { data: session, error: sErr } = await supabase
    .from('session_init')
    .select('*')
    .eq('id', sessionId)
    .gt('expires_at', new Date().toISOString())
    .is('used_at', null)
    .single();

  if (sErr || !session) {
    return jsonErr(404, '세션이 만료되었거나 존재하지 않습니다', cors);
  }

  // ── 학생 정보 조회 ──
  const { data: student } = await supabase
    .from('students')
    .select('*')
    .eq('user_no', session.user_no)
    .single();

  // ── 1회 사용 마크 (재호출 방지) — 선택적 ──
  // 새로고침 복원을 위해 expires_at 까지는 다회 조회 허용하려면 used_at 갱신 X
  // await supabase.from('session_init').update({ used_at: new Date().toISOString() }).eq('id', sessionId);

  return new Response(JSON.stringify({
    success: true,
    student: {
      user_no: session.user_no,
      name: student?.name || '',
      section: student?.section || null,
      school_grade: student?.school_grade || null,
      academy_no: session.academy_no,
    },
    session: {
      payment_fn: session.payment_fn,
      training_round: session.training_round,
      is_payment: session.is_payment,
    },
  }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});

function jsonErr(status: number, message: string, cors: Record<string, string>) {
  return new Response(JSON.stringify({ success: false, status, message }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
