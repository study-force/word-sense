// ════════════════════════════════════════════════════════════════
// Edge Function: wordsense-rank
//
// 역할: 결과 페이지 랭킹(전체 학생 기준) 집계.
//   RLS로 anon은 attempts/students를 못 읽으므로, service_role로 서버에서 집계해 안전 반환.
//
// 입력 (POST application/json):
//   { user_no, area_id, session_init_id? }   (session_init_id = 방금 끝낸 훈련 — 본인 과거분에서 제외)
//     - user_no: 현재 학생(본인) — 집계에서 제외(본인은 프론트가 현재 세션값으로 넣음)
//     - area_id: 누적 랭킹(영역 내)용
//
// 응답:
//   { success, others: { retrToday[], comboToday[], masterToday[], cumulArea[] }, me_cumul_past }
//     - 각 리스트 = [{ user_no, name, count }]  (본인 제외, 정렬 X — 프론트가 '나' 합쳐 정렬)
//     - retr/combo/master = '오늘'(KST) 집계, cumulArea = 영역 내 전체 누적(인출+확장)
//     - me_cumul_past = 본인의 영역 누적(저장분) — 프론트가 현재 세션분 더함
//     - me_today_past / me_best_past = 본인 오늘 앞선 훈련 합계 / 지난날 하루 최고 {retr, combo, master}
//   + known: { today[], cumul[] }, me_known: { today_past, best_past, cumul_past }  (2026-10-16, 랭킹 2종)
//     - '내 어휘' 기준: 오늘 새로 내 어휘가 된 수 / 영역·과정 누적 내 어휘 수 (RPC wordsense_rank_known)
//     - 입력에 level('초등'|'중등')·round_no 추가 — 누적은 과정별, 이 영역 1회차~지금 회차까지만(앞 회차 학생도 공평하게)
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

// KST 날짜 키 (yyyy-mm-dd)
function kstDayKey(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
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
  // 방금 끝낸 훈련(입장권) — 저장이 랭킹 조회보다 먼저 끝났어도 '나' 과거분에서 빼서 이중 집계 방지
  const curSid = body.session_init_id ? String(body.session_init_id) : null;
  const level = body.level === '중등' ? '중등' : '초등';
  const round = Number.isFinite(Number(body.round_no)) && body.round_no != null ? Number(body.round_no) : null;   // 누적은 이 회차까지만
  // 랭킹 토글 [전체|초등|중등] × [전체|우리학원] — filter_level 키가 있으면 토글 사용(null=전체), academy_no=우리학원
  const useFilter = Object.prototype.hasOwnProperty.call(body, 'filter_level');
  const filterLevel = body.filter_level === '초등' || body.filter_level === '중등' ? body.filter_level : null;
  const academyNo = body.academy_no != null && body.academy_no !== '' ? Number(body.academy_no) : null;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    // 이름 맵
    const { data: studs } = await supabase.from('students').select('user_no, name');
    const nameOf = new Map((studs || []).map((s: any) => [String(s.user_no), s.name]));
    const label = (k: string) => nameOf.get(k) || ('회원' + k);

    // 오늘(KST) attempts — 전체
    const { data: today } = await supabase.from('attempts')
      .select('member_no, retrieve_count, extend_count, correct_words')
      .gte('finished_at', startOfTodayKST());   // 재훈련(is_retry) 포함 — 대표님 결정

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
    for (const r of cumulRows) {
      const k = String(r.member_no);
      const v = (r.retrieve_count || 0) + (r.extend_count || 0);
      if (userNo && k === userNo) continue;   // 본인 누적은 아래 me 집계에서
      cumMap.set(k, (cumMap.get(k) || 0) + v);
    }

    // ── 본인: 오늘 앞서 한 훈련 합계 + 지난날 하루 최고 기록 + 영역 누적 (방금 끝낸 훈련 제외) ──
    //   오늘 기록 = 오늘 한 훈련 전부(재훈련 포함)의 합, 최고 기록 = 하루 합계 중 최고 (대표님 결정)
    let meCumulPast = 0;
    const meTodayPast = { retr: 0, combo: 0, master: 0 };
    const meBestPast  = { retr: 0, combo: 0, master: 0 };
    if (userNo) {
      const { data: mine } = await supabase.from('attempts')
        .select('finished_at, retrieve_count, extend_count, correct_words, area_id, session_init_id')
        .eq('member_no', userNo);
      const todayKey = kstDayKey(new Date().toISOString());
      const byDay = new Map<string, { retr: number; combo: number; master: number }>();
      for (const r of (mine || [])) {
        if (curSid && r.session_init_id && String(r.session_init_id) === curSid) continue;
        const retr = r.retrieve_count || 0, combo = retr + (r.extend_count || 0), master = r.correct_words || 0;
        if (areaId != null && String(r.area_id) === String(areaId)) meCumulPast += combo;
        if (!r.finished_at) continue;
        const d = kstDayKey(r.finished_at);
        const t = byDay.get(d) || { retr: 0, combo: 0, master: 0 };
        t.retr += retr; t.combo += combo; t.master += master;
        byDay.set(d, t);
      }
      for (const [d, t] of byDay) {
        if (d === todayKey) { meTodayPast.retr = t.retr; meTodayPast.combo = t.combo; meTodayPast.master = t.master; continue; }
        meBestPast.retr = Math.max(meBestPast.retr, t.retr);
        meBestPast.combo = Math.max(meBestPast.combo, t.combo);
        meBestPast.master = Math.max(meBestPast.master, t.master);
      }
    }
    const cumulArea = [...cumMap.entries()].map(([k, count]) => ({ user_no: Number(k), name: label(k), count }));

    // ── '내 어휘' 기준 랭킹 2종 (2026-10-16) ──
    const { data: kn, error: knErr } = await supabase.rpc('wordsense_rank_known', {
      p_area_id: areaId, p_level: level, p_member_no: userNo ? Number(userNo) : null, p_exclude_sid: curSid, p_round: round,
      p_use_filter: useFilter, p_filter_level: filterLevel, p_academy_no: academyNo,
    });
    if (knErr) console.error('[wordsense-rank] rank_known 실패:', knErr.message);
    const named = (arr: any[]) => (arr || []).map((x: any) => ({ user_no: Number(x.member_no), name: label(String(x.member_no)), count: x.count, areas: x.areas || null }));   // areas = 오늘 영역별 내역
    const known = { today: named(kn?.today), cumul: named(kn?.cumul) };
    const meKnown = { today_past: kn?.me_today_past || 0, best_past: kn?.me_best_past || 0, cumul_past: kn?.me_cumul_past || 0, today_areas: kn?.me_today_areas || [] };

    return new Response(JSON.stringify({
      success: true,
      others: { retrToday, comboToday, masterToday, cumulArea },
      me_cumul_past: meCumulPast,
      me_today_past: meTodayPast,   // 프론트가 방금 끝낸 훈련분을 더해 '오늘 기록'
      me_best_past: meBestPast,     // 지난날 하루 최고 — 프론트가 max(이 값, 오늘 기록)로 '최고 기록'
      known, me_known: meKnown,     // '내 어휘' 기준 랭킹 2종 (오늘·누적)
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
