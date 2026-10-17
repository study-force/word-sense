// 실서버 실력 점검 연기 시험 (2026-10-18) — 가상 학생 999000001로 생물 1~5회차 통과 → 점검 끝까지 → 결과지 → 기록 전부 삭제
//   실행: cd word-sense/db && node _prod_check_smoke.js
const fs = require('fs');
const { Client } = require('pg');
const env = Object.fromEntries(fs.readFileSync('../.secrets.local', 'utf8').split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => [l.split('=')[0], l.slice(l.indexOf('=') + 1).replace(/^['"]|['"]$/g, '')]));
const src = fs.readFileSync('../data-supabase.js', 'utf8');
const KEY = src.match(/PROD_SUPABASE_ANON_KEY = '([^']+)'/)[1];
const FN = 'https://fokuojmzhttxfkmiutmf.supabase.co/functions/v1/wordsense-unittest';
const M = 999000001;
const call = (body) => fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY, Origin: 'https://word.sfcenter.co.kr' }, body: JSON.stringify(body) }).then(r => r.json());

(async () => {
  const db = new Client({ connectionString: env.PROD_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const log = [];
  try {
    const { rows: [t] } = await db.query(`INSERT INTO session_init (user_no, payment_fn, training_round, is_payment, used_at)
      VALUES ($1, 'smoke-test', 1, false, now()) RETURNING id`, [M]);
    const ticket = t.id;
    const area = (await db.query(`SELECT id FROM areas WHERE slug='biology'`)).rows[0].id;
    // 1) 자격 없음 확인
    let r = await call({ action: 'status', ticket, level: '초등', area_id: area });
    log.push('status(훈련 전): ' + JSON.stringify({ ok: r.success, passed: r.passed_rounds }));
    r = await call({ action: 'start', ticket, level: '초등', area_id: area, unit: 1, items: [{}] });
    log.push('start(훈련 전): ' + (r.success ? '열림?!' : '막힘 ✓ ' + r.message));
    // 2) 생물 1~5회차 전부 내 어휘로 (가상 훈련 기록)
    const { rows: ss } = await db.query(`SELECT id, round_no FROM sessions WHERE area_id=$1 AND level='초등' AND round_no<=5 ORDER BY round_no`, [area]);
    for (const s of ss) {
      const { rows: [a] } = await db.query(`INSERT INTO attempts (member_no, session_id, area_id, total_words, finished_at) VALUES ($1,$2,$3,0,now()) RETURNING id`, [M, s.id, area]);
      await db.query(`INSERT INTO word_results (attempt_id, member_no, session_word_id, word_master_id, retrieve_passed, reinforce_passed)
        SELECT $1, $2, sw.id, sw.word_master_id, true, true FROM session_words sw WHERE sw.session_id=$3`, [a.id, M, s.id]);
    }
    r = await call({ action: 'status', ticket, level: '초등', area_id: area });
    log.push('status(통과 후): passed=' + JSON.stringify(r.passed_rounds));
    // 3) 25문항 만들기 (회차당 5개, 앱과 같은 모양)
    const { rows: words } = await db.query(`SELECT v.session_word_id, v.word_master_id, s.round_no, v.grade, v.word, v.hanja, v.choices
      FROM v_session_word_full v JOIN sessions s ON s.id=v.session_id WHERE s.id = ANY($1) ORDER BY s.round_no, v.order_in_session`, [ss.map(x => x.id)]);
    const items = [];
    for (const s of ss) words.filter(w => w.round_no === s.round_no && Array.isArray(w.choices) && w.choices.length >= 4).slice(0, 5).forEach(w => {
      const ch = w.choices.map(c => c.text), ci = w.choices.findIndex(c => c.is_correct);
      items.push({ session_word_id: w.session_word_id, word_master_id: w.word_master_id, round_no: w.round_no, grade: w.grade, word: w.word, hanja: w.hanja, hun: '', choices: ch, correct_idx: ci });
    });
    r = await call({ action: 'start', ticket, level: '초등', area_id: area, unit: 1, items });
    if (!r.success) throw new Error('start 실패: ' + r.message);
    const att = r.attempt; log.push('start: 문항 ' + att.items.length + '개, 정답 노출=' + (att.items[0].correct_idx !== undefined));
    // 4) 풀기: 1~20 바로 정답, 21~23 한자 보고 정답, 24~25 틀림
    for (const it of att.items) {
      const ci = items[it.ord - 1].correct_idx;
      if (it.ord >= 21 && it.ord <= 23) await call({ action: 'hint', ticket, attempt_id: att.id, ord: it.ord });
      const a = await call({ action: 'answer', ticket, attempt_id: att.id, ord: it.ord, choice_idx: it.ord >= 24 ? (ci + 1) % 4 : ci, ms: 3000 });
      if (!a.success) throw new Error('answer 실패 ' + it.ord + ': ' + a.message);
    }
    r = await call({ action: 'finish', ticket, attempt_id: att.id });
    log.push('finish: 점수 ' + r.attempt.score + ' (기대 ' + Math.round((20 * 4 + 3 * 2) * 100 / 100) + ') · 완전습득 ' + r.attempt.n_known + ' 추론 ' + r.attempt.n_hanja + ' 틀림 ' + (r.attempt.n_hanja_wrong + r.attempt.n_wrong));
    r = await call({ action: 'status', ticket, level: '초등', area_id: area });
    log.push('status(점검 후): ' + JSON.stringify(r.units));
    r = await call({ action: 'teacher', ticket });
    log.push('teacher(결과지): ' + (r.success ? '점검 ' + r.report.tests.length + '건, 생물 회차 ' + r.report.areas[0].rounds.length + '개' : '실패 ' + r.message));
  } finally {
    // 5) 가상 기록 전부 삭제
    const d1 = await db.query(`DELETE FROM test_attempts WHERE member_no=$1`, [M]);
    const d2 = await db.query(`DELETE FROM word_results WHERE member_no=$1`, [M]);
    const d3 = await db.query(`DELETE FROM attempts WHERE member_no=$1`, [M]);
    const d4 = await db.query(`DELETE FROM session_init WHERE user_no=$1`, [M]);
    log.push(`정리: 점검 ${d1.rowCount} · 어휘결과 ${d2.rowCount} · 훈련 ${d3.rowCount} · 입장권 ${d4.rowCount} 삭제`);
    await db.end();
    console.log(log.join('\n'));
  }
})().catch(e => { console.error('오류:', e.message); process.exit(1); });
