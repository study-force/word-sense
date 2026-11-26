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
//   OPS_ALERT_URL           — (선택) 더큰웍스 운영 알림 창구 주소(…/functions/v1/ops-alert). 없으면 알림 없이 기록만
//   OPS_ALERT_SECRET        — (선택) 그 창구의 한자어포스용 공유 비밀(x-ops-alert-secret)
//   COMPLETE_ADMIN_KEY      — (선택) 「실패분 다시 보내기」 관리용 열쇠(x-admin-key). 없으면 그 기능은 닫혀 있음
//
// 중복 방지: session_init.completed_at 이 있으면 학원 API를 다시 부르지 않음 (같은 토큰은 1회만 완료)
// 토큰: 1회 발급 후 service_back_token 테이블에 영구 캐시 (401이면 재발급)
//
// 재시도·실패 알림 (2026-11-26, docs/완료통보_재시도_알림_20261126.md):
//   · 첫 시도는 응답 전에 한다(시간 제한 10초). 통신 오류·시간 초과·5xx 면 학생 쪽에는 바로 답하고,
//     남은 재시도(3초·12초·30초 뒤)는 EdgeRuntime.waitUntil 로 뒤에서 끝까지 돈다(창을 닫아도 계속).
//   · 400 「이미 처리된」은 성공으로 취급. 그 밖의 4xx 는 재시도하지 않는다.
//   · 끝내 실패하면 complete_failures 표에 남기고 더큰웍스 운영 알림 창구를 부른다.
//   · 관리용: { action:'resend_failed', limit?, dry_run? } + 헤더 x-admin-key → 풀리지 않은 실패분을 다시 보낸다.
//   판정·재시도·알림 본문은 retry.mjs (단위 시험 retry.test.mjs)
// ════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runCompleteWithRetry, buildAlert, ATTEMPT_TIMEOUT_MS } from './retry.mjs';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXTERNAL_JWT_SECRET = Deno.env.get('EXTERNAL_JWT_SECRET')!;
const SERVICE_BACK_BASE_URL = Deno.env.get('SERVICE_BACK_BASE_URL')
  || 'https://www.futuretraining.co.kr:8143/service-back';
const OPS_ALERT_URL = Deno.env.get('OPS_ALERT_URL') || '';
const OPS_ALERT_SECRET = Deno.env.get('OPS_ALERT_SECRET') || '';
const COMPLETE_ADMIN_KEY = Deno.env.get('COMPLETE_ADMIN_KEY') || '';

// 응답을 보낸 뒤에도 끝까지 돌 일(재시도·알림) — 화면이 keepalive 로 한 번만 부르고 창을 닫아도 계속된다
function bg(p: Promise<unknown>) {
  const safe = p.catch((e) => console.error('[wordsense-complete] 뒤에서 도는 작업 오류:', e));
  try { if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(safe); } catch { /* 로컬 실행 */ }
}

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

  // ── 관리용: 실패분 다시 보내기 (열쇠가 맞을 때만) ──
  if (body && body.action === 'resend_failed') return await resendFailed(req, body, supabase, cors);

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

  // ── 학원 완료 시점 분리 (대표님 2026-11-02) ──
  //   결과 화면: { result, defer_academy:true } → 훈련 기록만 저장, 학원 완료 API·입장권 완료 표시는 안 함
  //   나의 훈사전 진입: { sessionId, finalize:true } → 기록 저장 없이 학원 완료 API(엔드데이트) + 입장권 완료 표시
  //   (구버전 화면은 두 값 없이 보냄 → 예전처럼 한 번에 처리)
  // 복습 입장권은 기록·학원 완료 모두 없음 (2026-11-02)
  if (sess && sess.training_mode === 'review') return ok({ success: true, saved: false, service_back: { skipped: 'review' } }, cors);
  const finalizeOnly = body.finalize === true;
  const deferAcademy = body.defer_academy === true && !finalizeOnly;
  if (finalizeOnly && !sess) return jsonErr(400, 'finalize에는 sessionId가 필요합니다', cors);

  // ── 1) 훈련 상세 저장 (실패해도 학원 완료 처리는 계속) ──
  let attemptId: number | null = null;
  const r = finalizeOnly ? null : body.result;
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

  // ── 결과 화면 단계 — 기록만 저장하고 학원 완료는 훈사전 진입 때 ──
  if (deferAcademy) {
    return ok({ success: true, saved: !!attemptId, service_back: { skipped: 'deferred' } }, cors);
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

  // 첫 시도 — 응답 전에 한 번(401 이면 토큰을 새로 받아 한 번 더). 통신 오류·시간 초과·5xx 면 남은 재시도는 뒤에서
  const call = ({ refreshToken }: { refreshToken: boolean }) => gateCall(supabase, payment_fn, training_round, study_token, refreshToken);
  const first = await runCompleteWithRetry(call, { waits: [] });
  const status: number = first.status, sbBody: any = first.body || {};
  const willRetry = first.outcome === 'exhausted';
  if (first.outcome !== 'ok' && first.outcome !== 'already') console.error('[wordsense-complete] service-back 호출 실패:', status, sbBody.message || '');

  const trainingEndSuccess = typeof sbBody.training_end_success === 'boolean' ? sbBody.training_end_success : null;
  // 학원 응답을 원장에 남김 (training_end_success=false → 학원 쪽 수기 처리 필요)
  // finalize(훈사전 진입)면 이 입장권으로 저장된 가장 최근 기록에 남김
  if (!attemptId && finalizeOnly && sess) {
    const { data: last } = await supabase.from('attempts').select('id').eq('session_init_id', sess.id)
      .order('id', { ascending: false }).limit(1).maybeSingle();
    if (last) attemptId = last.id;
  }
  if (trainingEndSuccess === false) console.warn('[wordsense-complete] training_end_success=false — 학원 수기 처리 필요', { payment_fn, training_round });

  // 결과 기록: attempts 의 학원 응답 칸, 완료됐거나(200) 이미 처리된 회차(400 '이미 처리된')면 세션에 완료 표시 → 재호출 방지,
  //   실패면 complete_failures 에 남김. 알림 호출은 응답을 늦추지 않게 뒤에서.
  const ctx: Ctx = {
    supabase, sess, attemptId, payment_fn, training_round, baseTries: null,
    memberNo: sess ? sess.user_no : (body.result?.user_no ?? null),
    academyNo: sess ? (sess.academy_no ?? null) : (body.result?.academy_no ?? null),
  };
  await applyResult(ctx, first, !willRetry, false);
  if (willRetry) bg(retryInBackground(ctx, call, first));

  if (status !== 200) {
    console.error('[wordsense-complete] service-back 응답:', status, sbBody);
    return jsonErr(status || 502, sbBody.message || 'service-back 호출 실패', cors, { saved: !!attemptId, ...(willRetry ? { retrying: true } : {}) });
  }
  return ok({ success: true, saved: !!attemptId, service_back: sbBody }, cors);
});

// ── 재시도·실패 기록·알림 ─────────────────────────────────────────
type Ctx = {
  supabase: any; sess: any; attemptId: number | null; payment_fn: string; training_round: number;
  memberNo: number | null; academyNo: number | null;
  baseTries: number | null;   // 이 요청 전에 이미 쌓여 있던 시도 횟수(실패 기록에 있던 값). null = 아직 안 읽음
};

// 게이트 완료 API 한 번 — 토큰은 캐시에서(refreshToken 이면 새로 받아). 통신 오류는 던진다(→ status 0 으로 판정)
async function gateCall(supabase: any, payment_fn: string, training_round: number, study_token: string | null, refreshToken: boolean) {
  let token = refreshToken ? null : await getCachedToken(supabase);
  if (!token) {
    if (refreshToken) console.warn('[wordsense-complete] 토큰 401 — 재발급 후 재시도');
    token = await issueNewToken(); await cacheToken(supabase, token);
  }
  const res = await callComplete(token, payment_fn, training_round, study_token);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// 남은 재시도 — 응답을 보낸 뒤 뒤에서 돈다
async function retryInBackground(ctx: Ctx, call: (o: { refreshToken: boolean }) => Promise<any>, first: any) {
  const r = await runCompleteWithRetry(call, {
    priorTries: 1, priorUncertain: first.uncertain, authRefreshed: first.authRefreshed,
    priorStatus: first.status, priorBody: first.body,
  });
  r.tries = first.tries + r.tries - 1;
  console.log('[wordsense-complete] 재시도 끝:', r.outcome, r.status, `${r.tries}번 시도`);
  await applyResult(ctx, r, true, true);
}

// 시도 결과를 DB 에 반영한다. final = 더 시도하지 않음(성공이든 실패든). inBackground = 응답을 이미 보냈는지
async function applyResult(ctx: Ctx, r: any, final: boolean, inBackground: boolean) {
  const { supabase, sess } = ctx;
  const done = r.outcome === 'ok' || r.outcome === 'already';
  const body = r.body || {};
  const tes = typeof body.training_end_success === 'boolean' ? body.training_end_success : null;
  const run = (p: Promise<unknown>) => inBackground ? p.catch((e) => console.error('[wordsense-complete] 알림 처리 오류:', e)) : (bg(p), Promise.resolve());
  try {
    if (ctx.attemptId) {
      const message = r.uncertainAlready
        ? `${body.message ?? ''} (앞선 시도가 답 없이 저장됨 — 무료·추가 회차 처리 결과 확인 필요)`
        : (body.message ?? null);
      await supabase.from('attempts').update({
        service_back_status: r.status, service_back_message: message, training_end_success: tes,
      }).eq('id', ctx.attemptId);
    }
    if (sess && done) {
      await supabase.from('session_init').update({ completed_at: new Date().toISOString() }).eq('id', sess.id);
    }
    if (done) {
      await resolveFailure(ctx, 'complete_failed', r.outcome === 'ok' ? 'sent' : 'already');
      // 회차는 저장됐지만 구 센터의 무료·추가 회차 처리가 실패(또는 결과를 모름) — 다시 보내도 「이미 처리된」만 오므로 기록·알림만
      if (r.outcome === 'ok' && tes === false) {
        const row = await saveFailure(ctx, 'training_end_failed', r);
        await run(alertFailure(ctx, 'training_end_failed', r, row));
      } else if (r.uncertainAlready) {
        await saveFailure(ctx, 'training_end_unknown', r);
      }
      return;
    }
    const row = await saveFailure(ctx, 'complete_failed', r);
    if (final && !(row && row.alerted_at)) await run(alertFailure(ctx, 'complete_failed', r, row));
  } catch (e) {
    console.error('[wordsense-complete] 결과 기록 오류(무시하고 계속):', e);
  }
}

function failureQuery(ctx: Ctx, kind: string) {
  let q = ctx.supabase.from('complete_failures').select('id, tries, alerted_at').eq('kind', kind).is('resolved_at', null);
  q = ctx.sess ? q.eq('session_init_id', ctx.sess.id)
    : q.is('session_init_id', null).eq('payment_fn', ctx.payment_fn).eq('training_round', ctx.training_round);
  return q.order('id', { ascending: false }).limit(1).maybeSingle();
}

// 실패 기록을 남긴다(같은 회차의 풀리지 않은 줄이 있으면 고친다). 표가 아직 없으면 로그만 남기고 넘어간다
async function saveFailure(ctx: Ctx, kind: string, r: any): Promise<{ id: number; alerted_at: string | null } | null> {
  const { supabase } = ctx;
  const { data: existing, error: selErr } = await failureQuery(ctx, kind);
  if (selErr) { console.error('[wordsense-complete] complete_failures 조회 오류(표를 아직 안 만들었을 수 있음):', selErr.message); return null; }
  if (ctx.baseTries === null) ctx.baseTries = existing ? Number(existing.tries) || 0 : 0;
  const patch = {
    last_status: r.status, last_message: r.body?.message != null ? String(r.body.message).slice(0, 500) : null,
    tries: (kind === 'complete_failed' ? ctx.baseTries : 0) + (Number(r.tries) || 1), last_tried_at: new Date().toISOString(),
  };
  if (existing) {
    const { error } = await supabase.from('complete_failures').update(patch).eq('id', existing.id);
    if (error) console.error('[wordsense-complete] complete_failures 고치기 오류:', error.message);
    return { id: existing.id, alerted_at: existing.alerted_at };
  }
  const { data, error } = await supabase.from('complete_failures').insert({
    kind, session_init_id: ctx.sess ? ctx.sess.id : null, attempt_id: ctx.attemptId,
    member_no: ctx.memberNo, academy_no: ctx.academyNo, payment_fn: ctx.payment_fn, training_round: ctx.training_round,
    ...patch,
  }).select('id, alerted_at').single();
  if (error) { console.error('[wordsense-complete] complete_failures 넣기 오류:', error.message); return null; }
  return data;
}

async function resolveFailure(ctx: Ctx, kind: string, how: string) {
  const { data: existing, error } = await failureQuery(ctx, kind);
  if (error || !existing) return;
  await ctx.supabase.from('complete_failures').update({ resolved_at: new Date().toISOString(), resolved_how: how }).eq('id', existing.id);
}

// 더큰웍스 운영 알림 창구 호출. 주소·비밀이 없거나 호출이 실패해도 훈련 저장·완료 처리에는 영향 없음
async function alertFailure(ctx: Ctx, kind: string, r: any, row: { id: number } | null) {
  let pendingCount: number | undefined;
  try {
    const { count } = await ctx.supabase.from('complete_failures').select('id', { count: 'exact', head: true })
      .eq('kind', kind).is('resolved_at', null);
    if (typeof count === 'number') pendingCount = count;
  } catch { /* 건수 없이 보낸다 */ }
  const alert = buildAlert({
    kind, memberNo: ctx.memberNo, academyNo: ctx.academyNo, round: ctx.training_round,
    status: r.status, message: r.body?.message, tries: (ctx.baseTries || 0) + (Number(r.tries) || 1),
    at: new Date().toISOString(), sessionInitId: ctx.sess ? ctx.sess.id : null, failureId: row ? row.id : null, pendingCount,
  });
  if (!OPS_ALERT_URL || !OPS_ALERT_SECRET) {
    console.warn('[wordsense-complete] 운영 알림 창구 미설정(OPS_ALERT_URL·OPS_ALERT_SECRET) — 기록만 남김:', alert.kind, alert.dedupe_key);
    return;
  }
  try {
    const res = await fetch(OPS_ALERT_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ops-alert-secret': OPS_ALERT_SECRET },
      body: JSON.stringify(alert), signal: AbortSignal.timeout(8000),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { console.error('[wordsense-complete] 운영 알림 실패:', res.status, out?.error || ''); return; }
    console.log('[wordsense-complete] 운영 알림:', out?.status || 'ok', alert.dedupe_key);
    if (row) await ctx.supabase.from('complete_failures').update({ alerted_at: new Date().toISOString() }).eq('id', row.id);
  } catch (e) {
    console.error('[wordsense-complete] 운영 알림 호출 오류:', (e as Error).message || e);
  }
}

function sameKey(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// 관리용 — 풀리지 않은 완료 통보 실패분을 다시 보낸다(한 건에 한 번씩, 게이트가 답하지 않으면 거기서 멈춤)
//   { action:'resend_failed', limit?: 1~50(기본 20), dry_run?: true }  헤더 x-admin-key
async function resendFailed(req: Request, body: any, supabase: any, cors: Record<string, string>) {
  if (!COMPLETE_ADMIN_KEY) return jsonErr(503, '관리용 열쇠(COMPLETE_ADMIN_KEY)가 설정되지 않았습니다', cors);
  if (!sameKey(req.headers.get('x-admin-key') || '', COMPLETE_ADMIN_KEY)) return jsonErr(401, '관리용 열쇠(x-admin-key)가 맞지 않습니다', cors);
  const limit = Math.min(50, Math.max(1, Number(body.limit) || 20));
  const { data: rows, error } = await supabase.from('complete_failures')
    .select('id, session_init_id, attempt_id, member_no, academy_no, payment_fn, training_round, tries, last_status, first_failed_at')
    .eq('kind', 'complete_failed').is('resolved_at', null).order('id', { ascending: true }).limit(limit);
  if (error) return jsonErr(503, 'complete_failures 표를 읽지 못했습니다: ' + error.message, cors);
  if (body.dry_run === true) {
    return ok({ success: true, dry_run: true, pending: rows.length, items: rows.map((x: any) => ({
      id: x.id, training_round: x.training_round, tries: x.tries, last_status: x.last_status, first_failed_at: x.first_failed_at })) }, cors);
  }
  const started = Date.now();
  const results: any[] = [];
  let stopped: string | null = null;
  for (const row of rows) {
    if (Date.now() - started > 90_000) { stopped = 'time_limit'; break; }
    let sess: any = null;
    if (row.session_init_id) {
      const { data } = await supabase.from('session_init').select('*').eq('id', row.session_init_id).maybeSingle();
      sess = data;
      if (!sess) { results.push({ id: row.id, result: 'no_session' }); continue; }   // 입장권이 지워짐 — 손으로 확인
    }
    const ctx: Ctx = {
      supabase, sess, attemptId: row.attempt_id, payment_fn: row.payment_fn, training_round: row.training_round,
      memberNo: row.member_no, academyNo: row.academy_no, baseTries: Number(row.tries) || 0,
    };
    if (sess && sess.completed_at) {   // 그사이 학생이 다시 들어와 완료됨
      await resolveFailure(ctx, 'complete_failed', 'already_completed');
      results.push({ id: row.id, result: 'already_completed' }); continue;
    }
    const r = await runCompleteWithRetry(
      ({ refreshToken }: { refreshToken: boolean }) => gateCall(supabase, row.payment_fn, row.training_round, sess ? (sess.study_token || null) : null, refreshToken),
      { waits: [] });
    await applyResult(ctx, r, true, true);
    results.push({ id: row.id, result: r.outcome, status: r.status });
    if (r.outcome === 'exhausted') { stopped = 'gate_unreachable'; break; }
  }
  const sent = results.filter((x) => x.result === 'ok' || x.result === 'already' || x.result === 'already_completed').length;
  return ok({ success: true, picked: rows.length, resolved: sent, still_failed: results.length - sent, stopped, results }, cors);
}

async function issueNewToken(): Promise<string> {
  const res = await fetch(`${SERVICE_BACK_BASE_URL}/api/public/external/token`, {
    method: 'POST', headers: { 'X-External-Secret': EXTERNAL_JWT_SECRET }, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
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
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
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
