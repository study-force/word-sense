// ════════════════════════════════════════════════════════════════
// Edge Function: wordsense-stats
//
// 역할: 통계 화면(영역별 훈련 현황 · 등급별 어휘 습득률) 실데이터.
//   service_role로 DB 함수 wordsense_student_stats(member_no, level) 호출 (anon은 실행 불가).
//
// 입력 (POST application/json): { user_no?, level }   user_no 없으면 습득 0·분모만   level = '초등' | '중등'
// 응답: { success, areas:[{slug,total,acquired,cleared}], total_distinct, acquired_distinct, grades:[{g,provided,acquired}] }
// ════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function safeHost(url: string) { try { return new URL(url).hostname; } catch { return ''; } }
function corsHeaders(origin: string | null): Record<string, string> {
  const h = origin ? safeHost(origin) : '';
  const isAllowed = !!h && (
    /\.sfcenter\.co\.kr$/.test(h) ||
    /\.sfos\.kr$/.test(h) ||
    h === 'study-force.github.io' ||
    h === 'localhost' ||
    h === '127.0.0.1'
  );
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin! : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, apikey',
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return jsonErr(405, 'Method not allowed', cors);

  let body: any;
  try { body = await req.json(); } catch { return jsonErr(400, '입력 JSON 파싱 실패', cors); }
  // user_no 없음(회차 테스트 등 학생 정보 없는 진입) → 기록 없는 학생으로 계산: 분모는 실제, 습득은 0
  const userNo = (body.user_no != null && Number.isFinite(Number(body.user_no))) ? Number(body.user_no) : -1;
  const level = body.level === '중등' ? '중등' : '초등';

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc('wordsense_student_stats', { p_member_no: userNo, p_level: level });
  if (error) {
    console.error('[wordsense-stats] rpc 실패:', error);
    return jsonErr(500, '통계 조회 실패', cors);
  }
  return new Response(JSON.stringify({ success: true, ...data }), {
    status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
  });
});

function jsonErr(status: number, message: string, cors: Record<string, string>) {
  return new Response(JSON.stringify({ success: false, status, message }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
