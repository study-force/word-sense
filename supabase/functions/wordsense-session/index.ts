// ════════════════════════════════════════════════════════════════
// Edge Function: wordsense-session
//
// 역할: word-sense.html이 ?st={uuid}로 진입했을 때, sessionId로 학생 데이터 조회.
//
// 입력 (GET):
//   ?id={sessionId}
//
// 처리:
//   1) session_init 조회 — 완료됨(completed_at)=410 completed (단, 재도전 중 닫은 것은 3시간 안 다시 열림) / 첫 열기는 expires_at(10분) 안, 이후 used_at+3시간까지 새로고침 허용
//   2) students JOIN → 학생 정보
//   3) 첫 열기 때 used_at = NOW() 기록
//   4) 응답: { student{…}, session{ id, payment_fn, training_round, training_area, training_level, is_payment } }
//
// 호출: word-sense.html에서 fetch
// ════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const REOPEN_MS = 3 * 60 * 60 * 1000;   // 처음 연 뒤 새로고침 허용 시간

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
    'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization',
    'Vary': 'Origin',               // 접속 주소마다 응답이 다름 — 브라우저가 다른 주소의 응답을 재사용하지 않게
    'Cache-Control': 'no-store',    // 입장권 상태(완료·만료)는 매번 새로 확인
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

  // ── 세션 조회 ──
  //   · 처음 여는 것은 발급 후 10분(expires_at) 안에만
  //   · 한 번 연 뒤(used_at)에는 3시간 동안 새로고침 허용 (훈련이 10분을 넘으므로)
  //   · 훈련 완료(completed_at)된 입장권은 폐기 — 다시 열 수 없음
  const { data: session, error: sErr } = await supabase
    .from('session_init')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (sErr || !session) {
    return jsonErr(404, '입장 정보를 찾을 수 없습니다', cors, 'not_found');
  }
  // 완료된 입장권 — 결과 화면의 '남은 어휘 재도전'을 하다 닫은 경우만 다시 열어 줌 (이어하기, 대표님 2026-10-29)
  //   조건: 처음 연 뒤 3시간 안 + 완료 뒤에 저장된 진행 상황(training_progress)이 있음 → 재훈련(retry)으로 열림
  let reopenRetry = false;
  if (session.completed_at) {
    const inWindow = session.used_at && Date.now() - new Date(session.used_at).getTime() <= REOPEN_MS;
    if (inWindow && session.training_area && session.training_round) {
      const { data: ar } = await supabase.from('areas').select('id').eq('slug', session.training_area).maybeSingle();
      if (ar) {
        const { data: pg } = await supabase.from('training_progress').select('updated_at')
          .eq('member_no', Number(session.user_no)).eq('level', session.training_level || '초등')
          .eq('area_id', ar.id).eq('round_no', Number(session.training_round)).maybeSingle();
        reopenRetry = !!pg && new Date(pg.updated_at).getTime() > new Date(session.completed_at).getTime();
      }
    }
    if (!reopenRetry) return jsonErr(410, '이미 완료된 훈련입니다', cors, 'completed');
  }
  // 선생님 결과지용 입장권(report)으로는 훈련을 열 수 없음
  if (session.training_mode === 'report') {
    return jsonErr(403, '훈련 입장권이 아닙니다', cors, 'not_training');
  }
  const now = Date.now();
  if (!session.used_at) {
    if (new Date(session.expires_at).getTime() < now) {
      return jsonErr(410, '입장 시간이 지났습니다', cors, 'expired');
    }
    await supabase.from('session_init').update({ used_at: new Date(now).toISOString() }).eq('id', sessionId);
  } else if (now - new Date(session.used_at).getTime() > REOPEN_MS) {
    return jsonErr(410, '입장 시간이 지났습니다', cors, 'expired');
  }

  // ── 학생 정보 조회 ──
  const { data: student } = await supabase
    .from('students')
    .select('*')
    .eq('user_no', session.user_no)
    .single();

  // ── 과정별 '내 어휘'(인출·다시 인출 + 강화 통과) — 앱이 금색 칩으로 켜고 출제에서 뺌 ──
  let knownIds: number[] = [];
  try {
    const { data: kw } = await supabase.rpc('wordsense_known_words', { p_member_no: session.user_no, p_level: session.training_level || '초등' });
    knownIds = (kw || []).map((x: any) => Number(x));
  } catch (e) { console.warn('[wordsense-session] 내 어휘 조회 실패(무시):', e); }
  // ── 훈사전: 이 영역·과정의 회차별 { round, total, known, trained } — 과거 회차까지 실제 누적 표시 ──
  let areaProgress: any[] = [];
  try {
    const { data: ar } = await supabase.from('areas').select('id').eq('slug', session.training_area).maybeSingle();
    if (ar) {
      const { data: ap } = await supabase.rpc('wordsense_area_progress', { p_member_no: session.user_no, p_area_id: ar.id, p_level: session.training_level || '초등' });
      areaProgress = ap || [];
    }
  } catch (e) { console.warn('[wordsense-session] 훈사전 집계 실패(무시):', e); }

  return new Response(JSON.stringify({
    success: true,
    known_wm_ids: knownIds,
    area_progress: areaProgress,
    student: {
      user_no: session.user_no,
      name: student?.name || '',
      section: student?.section || null,
      school_grade: student?.school_grade || null,
      academy_no: session.academy_no,
    },
    session: {
      id: session.id,
      payment_fn: session.payment_fn,
      training_round: session.training_round,
      training_area: session.training_area || null,     // 앱이 이 영역·회차로 콘텐츠를 불러옴
      training_level: session.training_level || '초등',
      training_mode: reopenRetry ? 'retry' : (session.training_mode || 'normal'),  // retry = 재훈련 (내일의 한자 없이 종료)
      is_payment: session.is_payment,
      // study_token은 브라우저로 보내지 않음 — 완료 시 서버(wordsense-complete)가 session_init에서 직접 읽음
    },
  }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});

function jsonErr(status: number, message: string, cors: Record<string, string>, code = '') {
  return new Response(JSON.stringify({ success: false, status, message, code }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
