// ════════════════════════════════════════════════════════════════
// Edge Function: wordsense-rank
//
// 역할: 결과 페이지 랭킹(전체 학생 기준) 집계.
//   RLS로 anon은 attempts/students를 못 읽으므로, service_role로 서버에서 집계해 안전 반환.
//
// 입력 (POST application/json):
//   { user_no, area_id }
//     - user_no: 현재 학생(본인) — 집계에서 제외(본인은 프론트가 현재 세션값으로 넣음)
//     - area_id: 누적 랭킹(영역 내)용
//
// 응답:
//   { success, others: { retrToday[], comboToday[], masterToday[], cumulArea[] }, me_cumul_past }
//     - 각 리스트 = [{ user_no, name, count }]  (본인 제외, 정렬 X — 프론트가 '나' 합쳐 정렬)
//     - retr/combo/master = '오늘'(KST) 집계, cumulArea = 영역 내 전체 누적(인출+확장)
//     - me_cumul_past = 본인의 영역 누적(저장분) — 프론트가 현재 세션분 더함
//
// ⚠️ 집계는 현재 JS in-memory (오픈 전 소량). 데이터 커지면 Postgres RPC/뷰로 이관 권장.
// ════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function safeHost(url: string) { try { return new URL(url).hostname; } catch { return ''; } }
function corsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin && (
    /\.sfcenter\.co\.kr$/.test(safeHost(origin)) ||
    /\.sfos\.kr$/.test(safeHost(origin)) ||
    safeHost(origin) === 'localhost' ||
    safeHost(origin) === '127.0.0.1'
  );
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin! : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, apikey',
  };
}

// 오늘 00:00 KST(UTC+9)의 UTC ISO 문자열
function startOfTodayKST(): string {
  const now = Date.now();
  const kst = new Date(now + 9 * 3600 * 1000);
  const startUtcMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 0, 0, 0) - 9 * 3600 * 1000;
  return new Date(startUtcMs).toISOString();
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const cors = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return jsonErr(405, 'Method not allowed', cors);

  let body: any;
  try { body = await req.json(); } catch { return jsonErr(400, '입력 JSON 파싱 실패', cors); }
  const userNo = body.user_no != null ? String(body.user_no) : null;
  const areaId = body.area_id != null ? body.area_id : null;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    // 이름 맵
    const { data: studs } = await supabase.from('students').select('user_no, name');
    const nameOf = new Map((studs || []).map((s: any) => [String(s.user_no), s.name]));
    const label = (k: string) => nameOf.get(k) || ('회원' + k);

    // 오늘(KST) attempts — 전체
    const { data: today } = await supabase.from('attempts')
      .select('member_no, retrieve_count, extend_count, correct_words')
      .gte('finished_at', startOfTodayKST());

    // 영역 누적 attempts — 전체
    let cumulRows: any[] = [];
    if (areaId != null) {
      const { data: ca } = await supabase.from('attempts')
        .select('member_no, retrieve_count, extend_count')
        .eq('area_id', areaId);
      cumulRows = ca || [];
    }

    // 오늘 집계 (본인 제외)
    const aggToday = (valFn: (r: any) => number) => {
      const m = new Map<string, number>();
      for (const r of (today || [])) {
        const k = String(r.member_no);
        if (userNo && k === userNo) continue;
        m.set(k, (m.get(k) || 0) + (valFn(r) || 0));
      }
      return [...m.entries()].map(([k, count]) => ({ user_no: Number(k), name: label(k), count }));
    };
    const retrToday   = aggToday((r) => r.retrieve_count || 0);
    const comboToday  = aggToday((r) => (r.retrieve_count || 0) + (r.extend_count || 0));
    const masterToday = aggToday((r) => r.correct_words || 0);

    // 영역 누적 (본인 제외) + 본인 과거 누적
    const cumMap = new Map<string, number>();
    let meCumulPast = 0;
    for (const r of cumulRows) {
      const k = String(r.member_no);
      const v = (r.retrieve_count || 0) + (r.extend_count || 0);
      if (userNo && k === userNo) { meCumulPast += v; continue; }
      cumMap.set(k, (cumMap.get(k) || 0) + v);
    }
    const cumulArea = [...cumMap.entries()].map(([k, count]) => ({ user_no: Number(k), name: label(k), count }));

    return new Response(JSON.stringify({
      success: true,
      others: { retrToday, comboToday, masterToday, cumulArea },
      me_cumul_past: meCumulPast,
    }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[wordsense-rank] 실패:', err);
    return jsonErr(500, '서버 오류: ' + (err as Error).message, cors);
  }
});

function jsonErr(status: number, message: string, cors: Record<string, string>) {
  return new Response(JSON.stringify({ success: false, status, message }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
