// ════════════════════════════════════════════════════════════════
// Edge Function: wordsense-rank
//
// 역할: 결과 화면 랭킹 2종 집계 (전체 학생 기준). RLS로 anon은 attempts/students를 못 읽으므로 service_role로 서버에서 집계.
//   ① 오늘의 랭킹 — 오늘(KST) 새로 '내 어휘'가 된 수, 영역별 내역 (RPC wordsense_rank_known)
//   ② 명예의 전당 — 이 영역·과정 1회차~지금 회차를 모두 만점(attempts.is_perfect)으로 끝낸 학생, 최신 등극순 100명
//   (2026-10-17 정리: 예전 4종 랭킹(인출·인출+확장·…) 집계는 앱이 더 이상 쓰지 않아 삭제)
//
// 입력 (POST application/json):
//   { user_no, area_id, level, round_no, session_init_id?, filter_level?, academy_no? }
//     - user_no: 본인 — 목록에서 빼고 me_* 로 따로 돌려줌(앱이 방금 끝낸 훈련분을 더함)
//     - session_init_id: 방금 끝낸 훈련 — 저장이 먼저 끝났어도 이중 집계 안 되게 본인 과거분에서 제외
//     - filter_level: 토글 [전체|초등|중등] (키가 있으면 토글 사용, null=전체) / academy_no: 토글 [우리학원]
//
// 응답:
//   { success,
//     known: { today: [{ name, count, areas:[{area,count}] }] },   // 본인 제외, 이름은 가운데 가림(김*연)
//     me_known: { today_past, today_areas },                                   // 본인 오늘 앞선 훈련분
//     hall: [{ name, at, me }], me_hall_prev }                                 // 명예의 전당 / 본인 1~N-1회차 모두 만점 여부
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

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const cors = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return jsonErr(405, 'Method not allowed', cors);

  let body: any;
  try { body = await req.json(); } catch { return jsonErr(400, '입력 JSON 파싱 실패', cors); }
  const userNo = body.user_no != null ? String(body.user_no) : null;
  const areaId = body.area_id != null ? body.area_id : null;
  const curSid = body.session_init_id ? String(body.session_init_id) : null;
  const level = body.level === '중등' ? '중등' : '초등';
  const round = Number.isFinite(Number(body.round_no)) && body.round_no != null ? Number(body.round_no) : null;
  const useFilter = Object.prototype.hasOwnProperty.call(body, 'filter_level');
  const filterLevel = body.filter_level === '초등' || body.filter_level === '중등' ? body.filter_level : null;
  const academyNo = body.academy_no != null && body.academy_no !== '' ? Number(body.academy_no) : null;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    // ① 오늘의 랭킹 (RPC) + ② 명예의 전당 재료(1~N회차 만점 기록)를 동시에
    const knP = supabase.rpc('wordsense_rank_known', {
      p_area_id: areaId, p_level: level, p_member_no: userNo ? Number(userNo) : null, p_exclude_sid: curSid, p_round: round,
      p_use_filter: useFilter, p_filter_level: filterLevel, p_academy_no: academyNo,
    });
    const hallP = (async () => {
      if (areaId == null || round == null) return null;
      const { data: ss } = await supabase.from('sessions').select('id, round_no')
        .eq('area_id', areaId).eq('level', level).lte('round_no', round);
      const sids = (ss || []).map((x: any) => x.id);
      if (!sids.length) return null;
      const { data: pf } = await supabase.from('attempts').select('member_no, session_id, finished_at, session_init_id')
        .in('session_id', sids).eq('is_perfect', true);
      return { ss: ss || [], sids, pf: pf || [] };
    })();
    const [{ data: kn, error: knErr }, hallSrc] = await Promise.all([knP, hallP]);
    if (knErr) console.error('[wordsense-rank] rank_known 실패:', knErr.message);

    // 명예의 전당 후보 — member → session → 첫 만점 시각
    const per = new Map<string, Map<number, string>>();
    for (const r of (hallSrc?.pf || [])) {
      if (!r.finished_at) continue;
      if (curSid && r.session_init_id && String(r.session_init_id) === curSid) continue;   // 방금 끝낸 훈련은 앱이 더함
      const k = String(r.member_no);
      const m = per.get(k) || new Map<number, string>();
      const prev = m.get(r.session_id);
      if (!prev || r.finished_at < prev) m.set(r.session_id, r.finished_at);
      per.set(k, m);
    }

    // 이름·학원은 화면에 나갈 학생만 조회 (예전엔 students 전체를 읽었음)
    const ids = new Set<string>();
    for (const x of (kn?.today || [])) ids.add(String(x.member_no));
    for (const [k, m] of per) if (m.size === (hallSrc?.sids.length || -1)) ids.add(k);
    const studs: any[] = [];
    const idList = [...ids].map(Number).filter(Number.isFinite);
    for (let i = 0; i < idList.length; i += 500) {
      const { data } = await supabase.from('students').select('user_no, name, academy_no').in('user_no', idList.slice(i, i + 500));
      studs.push(...(data || []));
    }
    const nameOf = new Map(studs.map((s: any) => [String(s.user_no), s.name]));
    const acadOf = new Map(studs.map((s: any) => [String(s.user_no), s.academy_no != null ? Number(s.academy_no) : null]));
    // 다른 학생 이름은 가운데를 가림 — 홈페이지 랭킹판(wordsense_mask_name)과 같은 규칙 (2026-10-29 개발팀 문의)
    //   김태연 → 김*연, 이서 → 이*, 본인은 앱이 자기 이름으로 따로 표시
    const mask = (n: string | null | undefined) => {
      const t = String(n || '').trim(); const c = [...t];
      if (!c.length) return '회원'; if (c.length === 1) return t; if (c.length === 2) return c[0] + '*';
      return c[0] + '*'.repeat(c.length - 2) + c[c.length - 1];
    };
    const label = (k: string) => mask(nameOf.get(k));

    // ① 오늘의 랭킹
    const today = (kn?.today || []).map((x: any) => ({
      name: label(String(x.member_no)), count: x.count, areas: x.areas || null,
    }));
    const meKnown = { today_past: kn?.me_today_past || 0, today_areas: kn?.me_today_areas || [] };

    // ② 명예의 전당 — 최신 등극(마지막으로 채운 회차의 첫 만점 시각)이 맨 위, 100명
    let hall: any[] = [];
    let meHallPrev = false;   // 본인: 지금 회차 이전(1~N-1)이 모두 만점인지 — 이번 훈련으로 만점이면 앱이 등극 처리
    if (hallSrc) {
      const roundOf = new Map(hallSrc.ss.map((x: any) => [x.id, x.round_no]));
      const before = hallSrc.sids.filter((id: number) => (roundOf.get(id) as number) < round!);
      for (const [k, m] of per) {
        if (userNo && k === userNo) meHallPrev = before.every((id: number) => m.has(id));
        if (m.size !== hallSrc.sids.length) continue;
        if (academyNo != null && acadOf.get(k) !== academyNo) continue;
        hall.push({ name: label(k), at: [...m.values()].sort().pop()!, me: !!(userNo && k === userNo) });
      }
      if (userNo && !per.has(userNo)) meHallPrev = before.length === 0;   // 1회차면 이전 회차 없음
      hall.sort((x, y) => (x.at < y.at ? 1 : -1));
      hall = hall.slice(0, 100);
    }

    return new Response(JSON.stringify({
      success: true,
      known: { today },
      me_known: meKnown,
      hall,
      me_hall_prev: meHallPrev,
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
