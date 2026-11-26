// ════════════════════════════════════════════════════════════════
// wordsense-complete 의 순수 로직 — 재시도 판정·재시도 돌리기·운영 알림 본문 만들기
//   DB·통신을 직접 하지 않는다(부르는 쪽이 call·sleep 을 넘긴다) → node --test 로 시험할 수 있다.
//   시험: node --test supabase/functions/wordsense-complete/retry.test.mjs
//   설명: docs/완료통보_재시도_알림_20261126.md
// ════════════════════════════════════════════════════════════════

/** 한 번 부를 때 기다리는 시간(ms). 넘으면 통신 오류로 본다. */
export const ATTEMPT_TIMEOUT_MS = 10_000;
/** 첫 시도가 실패한 뒤 다시 시도하기 전에 기다리는 시간(ms). 길이 = 재시도 횟수(3번 → 모두 4번 시도). */
export const RETRY_WAITS_MS = [3_000, 12_000, 30_000];
/** 재시도 전체에 쓰는 시간 한도(ms). Edge Function 시간 제한(무료 150초) 안에 끝나게 한다. */
export const TOTAL_BUDGET_MS = 120_000;

const ALREADY_RE = /이미 처리된/;

/**
 * 게이트 완료 API 응답 한 번을 판정한다.
 *   ok      200 — 회차 저장됨(training_end_success 가 false 여도 회차는 저장된 것 → 재시도해도 「이미 처리된」만 돌아온다)
 *   already 400 「이미 처리된 훈련 회차입니다.」 — 센터에는 이미 끝난 것으로 돼 있다 → 성공으로 취급
 *   auth    401 — 토큰을 새로 받아 한 번 더
 *   retry   통신 오류·시간 초과(status 0)·408·425·429·5xx — 잠시 뒤 다시
 *   fail    그 밖의 4xx(결제 정보 없음·훈련 정보 없음·토큰 불일치·입력값 오류 등) — 다시 보내도 같은 답이므로 재시도하지 않음
 */
export function classifyComplete(status, body) {
  const s = Number(status) || 0;
  const msg = body && body.message != null ? String(body.message) : '';
  if (s === 200) return 'ok';
  if (s === 400 && ALREADY_RE.test(msg)) return 'already';
  if (s === 401) return 'auth';
  if (s === 0 || s === 408 || s === 425 || s === 429 || s >= 500) return 'retry';
  return 'fail';
}

/** 최종 실패의 갈래 — 알림을 묶는 기준. unreachable(게이트가 답하지 않음) · auth(인증) · rejected(이 회차만 거절) */
export function failureReason(status) {
  const s = Number(status) || 0;
  if (s === 401) return 'auth';
  if (s === 0 || s === 408 || s === 425 || s === 429 || s >= 500) return 'unreachable';
  return 'rejected';
}

/**
 * 완료 API 를 판정에 따라 여러 번 부른다.
 *   call({ refreshToken }) → { status, body }  (던지면 통신 오류로 본다)
 *   opts.priorTries     이미 시도한 횟수(첫 시도를 밖에서 했으면 1) — 남은 재시도만 돈다
 *   opts.priorUncertain 앞선 시도가 「답을 못 받은」(통신 오류·시간 초과) 것이었는지
 *   opts.authRefreshed  앞에서 이미 토큰을 새로 받았는지(401 재발급은 한 번만)
 *   opts.waits          기다리는 시간 목록. 빈 목록이면 한 번만 부른다(401 재발급 한 번은 포함)
 * 돌려주는 값: { outcome: 'ok'|'already'|'fail'|'exhausted', status, body, tries, uncertainAlready, uncertain, authRefreshed }
 *   exhausted        — 다시 시도할 만한 실패(통신 오류·5xx 등)인데 정해진 횟수·시간을 다 썼다
 *   uncertainAlready — 답을 못 받은 시도 뒤에 「이미 처리된」이 온 경우. 앞선 시도가 실제로는 저장됐다는 뜻이며,
 *                      그때의 training_end_success 값은 알 수 없다.
 */
export async function runCompleteWithRetry(call, opts = {}) {
  const waits = opts.waits || RETRY_WAITS_MS;
  const budgetMs = opts.budgetMs ?? TOTAL_BUDGET_MS;
  const timeoutMs = opts.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now || (() => Date.now());
  const started = now();

  let tries = opts.priorTries || 0;
  let uncertain = !!opts.priorUncertain;
  let authRefreshed = !!opts.authRefreshed;
  let refreshToken = false;
  let last = { status: opts.priorStatus || 0, body: opts.priorBody || {} };

  // 첫 시도를 밖에서 이미 했으면 기다렸다가 시작한다
  let waitIdx = Math.max(0, tries - 1);
  const done = (outcome, uncertainAlready = false) => ({ outcome, ...last, tries, uncertainAlready, uncertain, authRefreshed });
  if (tries > 0) {
    if (waitIdx >= waits.length) return done('exhausted');
    await sleep(waits[waitIdx]);
    waitIdx++;
  }

  for (;;) {
    let res;
    try { res = await call({ refreshToken }); }
    catch (e) { res = { status: 0, body: { message: String((e && e.message) || e) } }; }
    refreshToken = false;
    tries++;
    last = { status: Number(res && res.status) || 0, body: (res && res.body) || {} };
    const verdict = classifyComplete(last.status, last.body);

    if (verdict === 'ok') return done('ok');
    if (verdict === 'already') return done('already', uncertain);
    if (verdict === 'fail') return done('fail');
    if (verdict === 'auth') {
      if (authRefreshed) return done('fail');
      authRefreshed = true; refreshToken = true;   // 토큰만 새로 받아 바로 한 번 더(기다리지 않음)
      continue;
    }
    // retry
    if (last.status === 0) uncertain = true;
    if (waitIdx >= waits.length) return done('exhausted');
    const wait = waits[waitIdx];
    if (now() - started + wait + timeoutMs > budgetMs) return done('exhausted');
    await sleep(wait);
    waitIdx++;
  }
}

/** 알림에 싣는 글에서 연락처·전자우편 꼴을 지우고 길이를 줄인다(게이트 오류 문구가 그대로 실리므로). */
export function scrub(text, max = 120) {
  return String(text == null ? '' : text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[지움]')
    .replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, '[지움]')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

function kstStamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

/**
 * 더큰웍스 운영 알림 창구(ops-alert)에 보낼 내용을 만든다. 개인정보 없이 — 회원 번호·학원 번호·회차·시각만.
 *   f.kind  'complete_failed'(센터에 완료가 안 남음) | 'training_end_failed'(회차는 저장됐으나 무료·추가 회차 처리 실패)
 *   중복 방지 키: 게이트 장애·인증 문제·무료/추가 회차 처리 실패는 종류마다 하나로 묶고(한꺼번에 여러 명이 실패해도 알림 한 번),
 *                 이 회차만 거절된 경우는 회차마다 따로.
 */
export function buildAlert(f) {
  const who = `회원 ${f.memberNo ?? '-'} · 학원 ${f.academyNo ?? '-'} · ${f.round ?? '-'}회차`;
  const when = kstStamp(f.at);
  const pending = Number.isFinite(f.pendingCount) && f.pendingCount > 1 ? `\n풀리지 않은 실패 기록 ${f.pendingCount}건` : '';
  const ref = f.failureId ? ` (실패 기록 #${f.failureId})` : '';
  const one = f.sessionInitId || `${f.memberNo ?? 'x'}-${f.round ?? 'x'}`;

  if (f.kind === 'training_end_failed') {
    return {
      source: 'wordsense', kind: 'training_end_failed', severity: 'urgent',
      title: '한자어포스 — 회차는 저장됐으나 무료·추가 회차 처리 실패',
      body: `${who}\n${when} · 센터에서 손으로 처리해야 합니다${ref}${pending}`,
      dedupe_key: 'wordsense:training_end_failed',
    };
  }
  const reason = failureReason(f.status);
  const why = reason === 'unreachable' ? `게이트가 답하지 않음(${f.status || '통신 오류'})`
    : reason === 'auth' ? '게이트 인증 실패(401)'
    : `게이트가 거절함(${f.status}: ${scrub(f.message, 60) || '사유 없음'})`;
  return {
    source: 'wordsense', kind: 'complete_failed', severity: 'urgent',
    title: '한자어포스 — 센터 완료 통보 실패',
    body: `${who}\n${when} · ${f.tries ?? 1}번 시도 · ${why}\n학생은 훈련을 끝냈지만 센터에는 끝나지 않은 것으로 남아 있습니다${ref}${pending}`,
    dedupe_key: reason === 'rejected' ? `wordsense:complete_failed:${one}` : `wordsense:complete_failed:${reason}`,
  };
}
