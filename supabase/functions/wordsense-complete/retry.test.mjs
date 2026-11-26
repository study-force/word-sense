// 시험: node --test supabase/functions/wordsense-complete/retry.test.mjs
//   실제 게이트·실제 알림은 부르지 않는다(가짜 call·sleep 을 넘긴다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyComplete, failureReason, runCompleteWithRetry, buildAlert, scrub,
  RETRY_WAITS_MS, FIRST_TIMEOUT_MS, RETRY_TIMEOUT_MS, TOKEN_TIMEOUT_MS, TOTAL_BUDGET_MS, TOKEN_RECHECK_MS,
  alertRetryDelayMs, numOrNull,
} from './retry.mjs';

// 정해 둔 응답을 차례로 돌려주는 가짜 게이트
function fakeGate(replies) {
  const calls = [];
  const call = async (o) => {
    calls.push(o);
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  };
  return { call, calls };
}
function fakeClock() {
  let t = 0; const slept = [];
  return { sleep: async (ms) => { slept.push(ms); t += ms; }, now: () => t, slept };
}
const OK = { status: 200, body: { success: true, training_end_success: true, message: '훈련 정보가 저장되었습니다.' } };
const ALREADY = { status: 400, body: { status: 400, message: '이미 처리된 훈련 회차입니다.' } };
const BAD_TOKEN = { status: 400, body: { status: 400, message: '유효하지 않은 훈련 요청입니다.[토큰 불일치]' } };
const E500 = { status: 500, body: { status: 500, message: '서버 오류가 발생했습니다.' } };
const E401 = { status: 401, body: { status: 401, message: '토큰이 없습니다.' } };

test('판정 — 게이트 응답 꼴', () => {
  assert.equal(classifyComplete(200, OK.body), 'ok');
  assert.equal(classifyComplete(200, { success: true, training_end_success: false }), 'ok');   // 회차는 저장됨 → 재시도 안 함
  assert.equal(classifyComplete(400, ALREADY.body), 'already');
  assert.equal(classifyComplete(400, BAD_TOKEN.body), 'fail');
  assert.equal(classifyComplete(400, { message: '결제 정보를 찾을 수 없습니다.' }), 'fail');
  assert.equal(classifyComplete(400, { message: '훈련 정보가 없습니다.' }), 'fail');
  assert.equal(classifyComplete(400, { message: '입력값을 확인해주세요.' }), 'fail');
  assert.equal(classifyComplete(401, E401.body), 'auth');
  for (const s of [0, 408, 429, 500, 502, 503, 504]) assert.equal(classifyComplete(s, {}), 'retry', String(s));
  assert.equal(classifyComplete(404, {}), 'fail');
  assert.equal(classifyComplete(0, null), 'retry');
});

test('실패 갈래', () => {
  assert.equal(failureReason(0), 'unreachable');
  assert.equal(failureReason(503), 'unreachable');
  assert.equal(failureReason(401), 'auth');
  assert.equal(failureReason(400), 'rejected');
});

test('한 번에 성공하면 기다리지 않는다', async () => {
  const g = fakeGate([OK]); const c = fakeClock();
  const r = await runCompleteWithRetry(g.call, c);
  assert.equal(r.outcome, 'ok'); assert.equal(r.tries, 1); assert.deepEqual(c.slept, []);
});

test('5xx 두 번 뒤 성공 — 간격을 늘려 가며', async () => {
  const g = fakeGate([E500, E500, OK]); const c = fakeClock();
  const r = await runCompleteWithRetry(g.call, c);
  assert.equal(r.outcome, 'ok'); assert.equal(r.tries, 3);
  assert.deepEqual(c.slept, RETRY_WAITS_MS.slice(0, 2));
});

test('끝까지 실패 — 처음 1번 + 재시도 3번', async () => {
  const g = fakeGate([new Error('connection refused')]); const c = fakeClock();
  const r = await runCompleteWithRetry(g.call, c);
  assert.equal(r.outcome, 'exhausted'); assert.equal(r.tries, 1 + RETRY_WAITS_MS.length);
  assert.equal(r.status, 0); assert.match(r.body.message, /connection refused/);
  assert.deepEqual(c.slept, RETRY_WAITS_MS);
});

test('가장 나쁜 경우의 시간 — 뒤에서 도는 재시도는 한도 안, 첫 시도까지 합쳐도 150초 안', () => {
  const bgWorst = RETRY_WAITS_MS.reduce((a, b) => a + b, 0) + RETRY_WAITS_MS.length * RETRY_TIMEOUT_MS;
  assert.ok(bgWorst <= TOTAL_BUDGET_MS, String(bgWorst));
  assert.ok(FIRST_TIMEOUT_MS + TOKEN_TIMEOUT_MS + bgWorst < 150_000);
  assert.equal(FIRST_TIMEOUT_MS, 25_000);
});

test('시간 한도를 넘기게 되면 그만둔다', async () => {
  const g = fakeGate([E500]); const c = fakeClock();
  const r = await runCompleteWithRetry(g.call, { ...c, budgetMs: 20_000, timeoutMs: 10_000 });
  assert.equal(r.outcome, 'exhausted'); assert.equal(r.tries, 2);   // 3초 뒤 한 번 더, 그다음 12초는 한도 밖
});

test('4xx 거절은 재시도하지 않는다', async () => {
  const NO_STUDY = { status: 400, body: { status: 400, message: '훈련 정보가 없습니다.' } };
  const g = fakeGate([NO_STUDY, OK]); const c = fakeClock();
  const r = await runCompleteWithRetry(g.call, c);
  assert.equal(r.outcome, 'fail'); assert.equal(r.tries, 1); assert.equal(g.calls.length, 1); assert.deepEqual(c.slept, []);
});

test('「토큰 불일치」는 잠깐 뒤 한 번만 더 — 「이미 처리된」으로 바뀌면 성공(겹친 요청의 늦은 쪽)', async () => {
  const g = fakeGate([BAD_TOKEN, ALREADY]); const c = fakeClock();
  const r = await runCompleteWithRetry(g.call, { ...c, waits: [] });
  assert.equal(r.outcome, 'already'); assert.equal(r.uncertainAlready, false); assert.equal(r.tries, 2);
  assert.deepEqual(c.slept, [TOKEN_RECHECK_MS]);

  const g2 = fakeGate([BAD_TOKEN, BAD_TOKEN, ALREADY]); const c2 = fakeClock();   // 그대로면 실패, 더 부르지 않는다
  const r2 = await runCompleteWithRetry(g2.call, c2);
  assert.equal(r2.outcome, 'fail'); assert.equal(g2.calls.length, 2); assert.match(r2.body.message, /토큰 불일치/);
});

test('「이미 처리된」은 성공으로 취급', async () => {
  const g = fakeGate([ALREADY]); const c = fakeClock();
  const r = await runCompleteWithRetry(g.call, c);
  assert.equal(r.outcome, 'already'); assert.equal(r.uncertainAlready, false);
});

test('시간 초과 뒤 「이미 처리된」 — 앞선 시도가 저장된 것(무료·추가 회차 결과는 모름)', async () => {
  const g = fakeGate([new Error('timeout'), ALREADY]); const c = fakeClock();
  const r = await runCompleteWithRetry(g.call, c);
  assert.equal(r.outcome, 'already'); assert.equal(r.uncertainAlready, true); assert.equal(r.tries, 2);
});

test('500 뒤 「이미 처리된」은 불확실로 보지 않는다(게이트가 직접 낸 500 은 저장이 취소된 것)', async () => {
  const g = fakeGate([E500, ALREADY]); const c = fakeClock();
  const r = await runCompleteWithRetry(g.call, c);
  assert.equal(r.uncertainAlready, false);
});

test('502·503·504 뒤 「이미 처리된」은 불확실(앞단이 대신 답했을 수 있다)', async () => {
  for (const s of [502, 503, 504]) {
    const g = fakeGate([{ status: s, body: {} }, ALREADY]);
    const r = await runCompleteWithRetry(g.call, fakeClock());
    assert.equal(r.outcome, 'already'); assert.equal(r.uncertainAlready, true, String(s));
  }
  const first = await runCompleteWithRetry(fakeGate([{ status: 503, body: {} }]).call, { ...fakeClock(), waits: [] });
  assert.equal(first.outcome, 'exhausted'); assert.equal(first.uncertain, true);
});

test('토큰 발급 실패(완료 API 를 부르지 못함)는 불확실로 치지 않는다', async () => {
  const NOT_SENT = { status: 0, body: { message: '토큰 발급 실패 503' }, sent: false };
  const g = fakeGate([NOT_SENT, ALREADY]);
  const r = await runCompleteWithRetry(g.call, fakeClock());
  assert.equal(r.outcome, 'already'); assert.equal(r.uncertainAlready, false);
  const first = await runCompleteWithRetry(fakeGate([NOT_SENT]).call, { ...fakeClock(), waits: [] });
  assert.equal(first.outcome, 'exhausted'); assert.equal(first.uncertain, false);
});

test('401 — 토큰을 새로 받아 바로 한 번 더, 두 번째 401 은 실패', async () => {
  const g = fakeGate([E401, OK]); const c = fakeClock();
  const r = await runCompleteWithRetry(g.call, c);
  assert.equal(r.outcome, 'ok'); assert.deepEqual(g.calls.map((x) => x.refreshToken), [false, true]); assert.deepEqual(c.slept, []);

  const g2 = fakeGate([E401, E401, OK]);
  const r2 = await runCompleteWithRetry(g2.call, fakeClock());
  assert.equal(r2.outcome, 'fail'); assert.equal(r2.status, 401); assert.equal(g2.calls.length, 2);
});

test('첫 시도를 밖에서 한 경우 — 기다렸다가 남은 재시도만', async () => {
  const g = fakeGate([E500, OK]); const c = fakeClock();
  const r = await runCompleteWithRetry(g.call, { ...c, priorTries: 1, priorStatus: 503 });
  assert.equal(r.outcome, 'ok'); assert.equal(r.tries, 3);
  assert.deepEqual(c.slept, RETRY_WAITS_MS.slice(0, 2));

  const g2 = fakeGate([ALREADY]);
  const r2 = await runCompleteWithRetry(g2.call, { ...fakeClock(), priorTries: 1, priorUncertain: true });
  assert.equal(r2.uncertainAlready, true);

  const g3 = fakeGate([E401]);   // 앞에서 이미 토큰을 새로 받았으면 다시 받지 않는다
  const r3 = await runCompleteWithRetry(g3.call, { ...fakeClock(), priorTries: 1, authRefreshed: true });
  assert.equal(r3.outcome, 'fail'); assert.equal(g3.calls.length, 1);
});

test('알림 본문 — 번호·회차·시각만, 중복 방지 키', () => {
  const base = { memberNo: 1234, academyNo: 56, round: 7, tries: 4, at: '2026-11-26T03:05:00Z', sessionInitId: 'abc-1', failureId: 9 };
  const a = buildAlert({ ...base, kind: 'complete_failed', status: 0, message: 'timeout' });
  assert.equal(a.source, 'wordsense'); assert.equal(a.kind, 'complete_failed');
  assert.equal(a.dedupe_key, 'wordsense:complete_failed:unreachable');   // 게이트 장애는 하나로 묶음
  assert.match(a.body, /회원 1234 · 학원 56 · 7회차/);
  assert.match(a.body, /2026-11-26 12:05/);   // 한국 시각
  assert.match(a.body, /4번 시도/); assert.match(a.body, /#9/);

  const b = buildAlert({ ...base, kind: 'complete_failed', status: 400, message: '유효하지 않은 훈련 요청입니다.[토큰 불일치]' });
  assert.equal(b.dedupe_key, 'wordsense:complete_failed:abc-1');          // 이 회차만 거절 → 회차마다
  assert.match(b.body, /토큰 불일치/);

  assert.equal(buildAlert({ ...base, kind: 'complete_failed', status: 401 }).dedupe_key, 'wordsense:complete_failed:auth');
  const t = buildAlert({ ...base, kind: 'training_end_failed', pendingCount: 3 });
  assert.equal(t.dedupe_key, 'wordsense:training_end_failed:abc-1'); assert.match(t.body, /3건/);   // 건마다 손으로 처리 → 따로
  assert.equal(buildAlert({ ...base, sessionInitId: null, kind: 'training_end_failed' }).dedupe_key, 'wordsense:training_end_failed:1234-7');
  assert.equal(t.severity, 'urgent');

  const u = buildAlert({ ...base, kind: 'training_end_unknown' });
  assert.equal(u.kind, 'training_end_unknown'); assert.equal(u.severity, 'normal');
  assert.equal(u.dedupe_key, 'wordsense:training_end_unknown:abc-1');

  for (const x of [a, b, t, u]) { assert.ok(x.title.length <= 120); assert.ok(x.body.length <= 1000); }
});

test('알림에 연락처·전자우편 꼴이 실리지 않는다', () => {
  assert.equal(scrub('문의 010-1234-5678 / a.b@example.com'), '문의 [지움] / [지움]');
  const a = buildAlert({ kind: 'complete_failed', status: 400, message: '담당 01012345678 에게', memberNo: 1, round: 1 });
  assert.doesNotMatch(a.body, /0101234/);
  assert.equal(scrub('x'.repeat(500)).length, 120);
});

test('알림 창구가 429 면 알려 준 시간 뒤 한 번 — 길어도 60초', () => {
  assert.equal(alertRetryDelayMs(429, { retry_after_sec: 20 }), 20_000);
  assert.equal(alertRetryDelayMs(429, { retry_after_sec: 600 }), 60_000);
  assert.equal(alertRetryDelayMs(429, {}), 60_000);
  assert.equal(alertRetryDelayMs(429, { retry_after_sec: 0 }), 1_000);
  for (const s of [200, 400, 401, 500, 503]) assert.equal(alertRetryDelayMs(s, { retry_after_sec: 5 }), null);
});

test('번호 칸은 유한한 수만', () => {
  assert.equal(numOrNull(1234), 1234); assert.equal(numOrNull('56'), 56); assert.equal(numOrNull(0), 0);
  for (const v of [null, undefined, '', 'abc', '1; drop', {}, NaN, Infinity, '<b>x</b>']) assert.equal(numOrNull(v), null);
});
