// 테섭 전용 샘플 (2026-10-23) — 회원 88660 초등: 생물·역사 6~10회차 통과 기록 + 실력 점검 여러 건 (결과지 3쪽 보기용)
//   실행: cd word-sense/db && node _seed_sample_report_dev.js   (운영 DB엔 절대 쓰지 않음)
const fs = require('fs'); const { Client } = require('pg');
const env = Object.fromEntries(fs.readFileSync('../.secrets.local', 'utf8').split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => [l.split('=')[0], l.slice(l.indexOf('=') + 1).replace(/^['"]|['"]$/g, '')]));
const KEY = fs.readFileSync('../data-supabase.js', 'utf8').match(/DEV_SUPABASE_ANON_KEY = '([^']+)'/)[1];
const FN = 'https://xzxgsqpvtckxgvipchsy.supabase.co/functions/v1/wordsense-unittest';
const M = 88660;
const call = b => fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY, Origin: 'https://word.sfos.kr' }, body: JSON.stringify(b) }).then(r => r.json());
(async () => {
  const db = new Client({ connectionString: env.DEV_DB_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
  const { rows: [t] } = await db.query(`INSERT INTO session_init (user_no, payment_fn, training_round, training_level, is_payment, used_at) VALUES ($1,'sample',1,'초등','N',now()) RETURNING id`, [M]);
  const ticket = t.id;
  const area = async slug => (await db.query(`SELECT id FROM areas WHERE slug=$1`, [slug])).rows[0].id;
  // 1) 회차 통과 기록 — 어휘 90%(짝수 회차) / 100%(홀수 회차) 내 어휘로
  async function passRounds(slug, from, to, daysAgo) {
    const aid = await area(slug);
    const { rows: ss } = await db.query(`SELECT id, round_no FROM sessions WHERE area_id=$1 AND level='초등' AND round_no BETWEEN $2 AND $3 ORDER BY round_no`, [aid, from, to]);
    for (const s of ss) {
      const at = `now() - interval '${daysAgo - (s.round_no - from)} days'`;
      const { rows: [a] } = await db.query(`INSERT INTO attempts (member_no, session_id, area_id, total_words, finished_at) VALUES ($1,$2,$3,0,${at}) RETURNING id`, [M, s.id, aid]);
      const { rows: ws } = await db.query(`SELECT id, word_master_id FROM session_words WHERE session_id=$1 ORDER BY id`, [s.id]);
      const keep = s.round_no % 2 ? ws.length : Math.ceil(ws.length * 0.9);
      for (const w of ws.slice(0, keep)) await db.query(`INSERT INTO word_results (attempt_id, member_no, session_word_id, word_master_id, retrieve_passed, reinforce_passed) VALUES ($1,$2,$3,$4,true,true)`, [a.id, M, w.id, w.word_master_id]);
    }
    return aid;
  }
  // 6~10회차는 첫 실행 때 넣음 — 1~5회차는 지금 통과 기준(80%)에 맞게 다시 훈련한 기록 추가
  const bio = await passRounds('biology', 1, 5, 14), his = await passRounds('history', 1, 5, 12);
  // 2) 실력 점검 — 앱과 같은 방식으로 25문항 풀기 (known개 바로 정답, hint개 한자 보고 정답, 나머지 틀림)
  async function check(aid, unit, known, hint) {
    const { rows: ss } = await db.query(`SELECT id, round_no FROM sessions WHERE area_id=$1 AND level='초등' AND round_no BETWEEN $2 AND $3 ORDER BY round_no`, [aid, unit * 5 - 4, unit * 5]);
    const { rows: words } = await db.query(`SELECT v.session_word_id, v.word_master_id, s.round_no, v.grade, v.word, v.hanja, v.choices FROM v_session_word_full v JOIN sessions s ON s.id=v.session_id WHERE s.id = ANY($1) ORDER BY s.round_no, v.order_in_session`, [ss.map(x => x.id)]);
    const items = [];
    for (const s of ss) words.filter(w => w.round_no === s.round_no && Array.isArray(w.choices) && w.choices.length >= 4).sort(() => Math.random() - .5).slice(0, 5).forEach(w => {
      items.push({ session_word_id: w.session_word_id, word_master_id: w.word_master_id, round_no: w.round_no, grade: w.grade, word: w.word, hanja: w.hanja, hun: '', choices: w.choices.map(c => c.text), correct_idx: w.choices.findIndex(c => c.is_correct) });
    });
    let r = await call({ action: 'start', ticket, level: '초등', area_id: aid, unit, items });
    if (!r.success) throw new Error('start ' + unit + ': ' + r.message);
    const att = r.attempt, order = att.items.map(x => x.ord).sort(() => Math.random() - .5);
    for (const it of att.items) {
      const k = order.indexOf(it.ord), ci = items[it.ord - 1].correct_idx;
      if (k >= known && k < known + hint) await call({ action: 'hint', ticket, attempt_id: att.id, ord: it.ord });
      const a = await call({ action: 'answer', ticket, attempt_id: att.id, ord: it.ord, choice_idx: k < known + hint ? ci : (ci + 1) % 4, ms: 2500 + Math.floor(Math.random() * 4000) });
      if (!a.success) throw new Error('answer: ' + a.message);
    }
    r = await call({ action: 'finish', ticket, attempt_id: att.id });
    console.log('점검', aid, unit + '구간', r.attempt.score + '점');
  }
  await check(bio, 1, 19, 3);   // 생물 1~5 재점검 → 최고 점수 바뀜
  await check(bio, 2, 17, 4);
  await check(bio, 2, 21, 2);
  await check(his, 2, 18, 4);
  await db.query(`DELETE FROM session_init WHERE id=$1`, [ticket]);
  await db.end();
})().catch(e => { console.error('오류:', e.message); process.exit(1); });
