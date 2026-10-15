// ════════════════════════════════════════════════════════════════
// Edge Function: wordsense-complete
//
// 역할: 학생 학습 완료 시 호출 — 두 가지 작업 (성효민 대리 확정: 둘 다 기록)
//   1) Supabase에 훈련 상세 저장 — attempts(+학원 회차 정보) / word_results   ← 원장
//   2) 학원 완료 API 호출 — service-back POST /api/public/hanja/study/complete
//      body { payment_fn, training_round, study_token }  (API v4: study_token 필수, 1회만 완료)
//      응답 training_end_success(false면 학원 쪽 수기 처리) → attempts에 기록
//
// 입력 (POST application/json):
//   { sessionId, result{...} }
//     sessionId 가 있으면 payment_fn·training_round·study_token 은 서버(session_init)에서 읽음 — 브라우저 값 신뢰 X
//     (구버전 호환: sessionId 없이 payment_fn·training_round 를 보내면 그대로 사용, study_token 없음)
//
// secrets:
//   EXTERNAL_JWT_SECRET     — service-back 토큰 발급용 (X-External-Secret) — 테섭=개발키, 실섭=상용키
//   SERVICE_BACK_BASE_URL   — 실섭 'https://www.futuretraining.co.kr:8143/service-back'
//                              테섭 'https://www.futuretraining.co.kr:8193/service-back'
//
// 중복 방지: session_init.completed_at 이 있으면 학원 API를 다시 부르지 않음 (같은 토큰은 1회만 완료)
// 토큰: 1회 발급 후 service_back_token 테이블에 영구 캐시 (401이면 재발급)
// ════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXTERNAL_JWT_SECRET = Deno.env.get('EXTERNAL_JWT_SECRET')!;
const SERVICE_BACK_BASE_URL = Deno.env.get('SERVICE_BACK_BASE_URL')
  || 'https://www.futuretraining.co.kr:8143/service-back';

function safeHost(url: string) { try { return new URL(url).hostname; } catch { return ''; } }
function corsHeaders(origin: string | null): Record<string, string> {
  const h = origin ? safeHost(origin) : '';
  const isAllowed = !!h && (/\.sfcenter\.co\.kr$/.test(h) || /\.sfos\.kr$/.test(h) || h === 'localhost' || h === '127.0.0.1');
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin! : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization',
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return jsonErr(405, 'Method not allowed', cors);

  let body: any;
  try { body = await req.json(); } catch { return jsonErr(400, '입력 JSON 파싱 실패', cors); }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // ── 진입 세션에서 학원 정보 읽기 (있으면 브라우저 값보다 우선) ──
  let sess: any = null;
  if (body.sessionId) {
    const { data } = await supabase.from('session_init').select('*').eq('id', body.sessionId).maybeSingle();
    sess = data;
    if (!sess) return jsonErr(404, '진입 세션을 찾을 수 없습니다', cors);
  }
  const payment_fn: string = sess ? sess.payment_fn : body.payment_fn;
  const training_round: number = sess ? Number(sess.training_round) : Number(body.training_round);
  const study_token: string | null = sess ? (sess.study_token || null) : (body.study_token || null);
  const isRetry = !!(sess && sess.training_mode === 'retry');   // 재훈련: Supabase에만 저장, 학원 완료 API 미호출
  if (!payment_fn || !Number.isFinite(training_round)) {
    return jsonErr(400, '필수 정보 누락: payment_fn, training_round', cors);
  }

  // ── 1) 훈련 상세 저장 (실패해도 학원 완료 처리는 계속) ──
  let attemptId: number | null = null;
  const r = body.result;
  if (r && r.user_no && r.session_id) {
    try {
      const { count } = await supabase.from('attempts')
        .select('id', { count: 'exact', head: true })
        .eq('member_no', r.user_no).eq('session_id', r.session_id);
      const { data: att, error: insErr } = await supabase.from('attempts').insert({
        member_no:       r.user_no,
        session_id:      r.session_id,
        area_id:         r.area_id ?? null,
        started_at:      r.started_at ?? undefined,   // NOT NULL(default now) — null 보내면 실패
        finished_at:     r.finished_at ?? new Date().toISOString(),
        duration_sec:    r.duration_sec ?? null,
        total_words:     r.total_words ?? 0,
        attempt_no:      (count || 0) + 1,
        current_stage:   'done',
        retrieve_count:  r.retrieve_count ?? 0,
        extend_count:    r.extend_count ?? 0,
        correct_words:   r.correct_words ?? 0,
        tier_level:      r.tier_level ?? 0,
        session_init_id: sess ? sess.id : null,
        payment_fn,
        training_round,
        is_retry:        isRetry,
        is_perfect:      !!r.is_perfect,                       // 이 훈련 후 회차 어휘 전부가 내 어휘
        known_count:     Number.isFinite(Number(r.known_count)) ? Number(r.known_count) : null,
      }).select('id').single();
      if (insErr) console.error('[wordsense-complete] attempts INSERT 오류:', insErr);
      else {
        attemptId = att.id;
        const rows = (Array.isArray(r.words) ? r.words : [])
          .filter((w: any) => w && Number.isFinite(Number(w.word_master_id)) && Number.isFinite(Number(w.session_word_id)))
          .map((w: any) => ({
            attempt_id: att.id, member_no: r.user_no,
            session_word_id: Number(w.session_word_id), word_master_id: Number(w.word_master_id),
            retrieve_passed: !!w.retrieve_passed, extend_passed: !!w.extend_passed, reinforce_passed: !!w.reinforce_passed,
            recall2_passed: !!w.recall2_passed,   // 3 다시 인출에서 떠올림 (4단계 훈련)
          }));
        if (rows.length) {
          const { error: wrErr } = await supabase.from('word_results').insert(rows);
          if (wrErr) console.error('[wordsense-complete] word_results INSERT 오류:', wrErr);
        }
      }
    } catch (e) {
      console.error('[wordsense-complete] 결과 저장 실패(무시하고 계속):', e);
    }
  }

  // ── 재훈련은 학원 기록을 바꾸지 않음 — 입장권만 완료 처리하고 끝 ──
  if (isRetry) {
    if (sess && !sess.completed_at) await supabase.from('session_init').update({ completed_at: new Date().toISOString() }).eq('id', sess.id);
    return ok({ success: true, saved: !!attemptId, service_back: { skipped: 'retry' } }, cors);
  }

  // ── 2) 학원 완료 API — 이미 완료한 세션이면 다시 부르지 않음 ──
  if (sess && sess.completed_at) {
    return ok({ success: true, saved: !!attemptId, service_back: { skipped: 'already_completed' } }, cors);
  }

  let status = 0, sbBody: any = {};
  try {
    let token = await getCachedToken(supabase);
    if (!token) { token = await issueNewToken(); await cacheToken(supabase, token); }
    let res = await callComplete(token, payment_fn, training_round, study_token);
    if (res.status === 401) {
      console.warn('[wordsense-complete] 토큰 401 — 재발급 후 재시도');
      token = await issueNewToken(); await cacheToken(supabase, token);
      res = await callComplete(token, payment_fn, training_round, study_token);
    }
    status = res.status;
    sbBody = await res.json().catch(() => ({}));
  } catch (err) {
    console.error('[wordsense-complete] service-back 호출 실패:', err);
    status = 0; sbBody = { message: String((err as Error).message || err) };
  }

  const trainingEndSuccess = typeof sbBody.training_end_success === 'boolean' ? sbBody.training_end_success : null;
  // 학원 응답을 원장에 남김 (training_end_success=false → 학원 쪽 수기 처리 필요)
  if (attemptId) {
    await supabase.from('attempts').update({
      service_back_status: status, service_back_message: sbBody.message ?? null, training_end_success: trainingEndSuccess,
    }).eq('id', attemptId);
  }
  if (trainingEndSuccess === false) console.warn('[wordsense-complete] training_end_success=false — 학원 수기 처리 필요', { payment_fn, training_round });

  // 완료됐거나(200) 이미 처리된 회차(400 '이미 처리된')면 세션에 완료 표시 → 재호출 방지
  const already = status === 400 && /이미 처리된/.test(String(sbBody.message || ''));
  if (sess && (status === 200 || already)) {
    await supabase.from('session_init').update({ completed_at: new Date().toISOString() }).eq('id', sess.id);
  }

  if (status !== 200) {
    console.error('[wordsense-complete] service-back 응답:', status, sbBody);
    return jsonErr(status || 502, sbBody.message || 'service-back 호출 실패', cors, { saved: !!attemptId });
  }
  return ok({ success: true, saved: !!attemptId, service_back: sbBody }, cors);
});

async function issueNewToken(): Promise<string> {
  const res = await fetch(`${SERVICE_BACK_BASE_URL}/api/public/external/token`, {
    method: 'POST', headers: { 'X-External-Secret': EXTERNAL_JWT_SECRET },
  });
  if (!res.ok) throw new Error(`토큰 발급 실패 ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.token) throw new Error('토큰 응답에 token 필드 없음');
  return data.token;
}

async function callComplete(token: string, payment_fn: string, training_round: number, study_token: string | null) {
  const payload: Record<string, unknown> = { payment_fn, training_round };
  if (study_token) payload.study_token = study_token;   // API v4 필수
  return await fetch(`${SERVICE_BACK_BASE_URL}/api/public/hanja/study/complete`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function getCachedToken(supabase: any): Promise<string | null> {
  const { data } = await supabase.from('service_back_token').select('token').eq('id', 'singleton').maybeSingle();
  return data?.token || null;
}
async function cacheToken(supabase: any, token: string) {
  await supabase.from('service_back_token').upsert({ id: 'singleton', token, issued_at: new Date().toISOString() }, { onConflict: 'id' });
}

function ok(obj: unknown, cors: Record<string, string>) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function jsonErr(status: number, message: string, cors: Record<string, string>, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ success: false, status, message, ...extra }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
