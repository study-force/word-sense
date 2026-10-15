// 민감 어휘(비하어·신체·성) 전체 학습 어휘에서 제외 — 대표님 결정 2026-10-15
//   1) 다른 문제의 오답 보기(choices)에 들어간 민감 어휘 → 같은 회차 다른 어휘 뜻으로 교체
//      (골디락스: 뜻 글자쌍 유사도 0.05~0.15 > 0~0.05 > 0.15~0.25 > 0 > 0.25~0.35, 0.35 이상·동의어·같은 뜻 제외)
//   2) 빈칸 오답 후보(fill_pools)에서 민감 어휘 제거
//   3) 회차 문제 연결(session_words) 삭제 — 백업 테이블에 원본 보관
//   word_master에는 남김(입력 시 안내용). 모든 변경은 admin_change_log에 기록.
// 사용: DB_URL=... node remove_sensitive_words_20261015.js [--apply]
const path = require('path');
const { Client } = require(path.join(__dirname, '../../sf-admin/node_modules/pg'));
const APPLY = process.argv.includes('--apply');
const NOTE = '민감 어휘 전체 제외(2026-10-15)';

function bigrams(s) {
  const t = String(s || '').replace(/[\s,.·()~\-]/g, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function jaccard(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach(x => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}
// 골디락스 순위 (작을수록 우선) — sf-admin lib/synonyms와 같은 구간
function band(j) {
  if (j >= 0.35) return 99;
  if (j >= 0.05 && j < 0.15) return 0;
  if (j > 0 && j < 0.05) return 1;
  if (j >= 0.15 && j < 0.25) return 2;
  if (j === 0) return 3;
  return 4; // 0.25~0.35
}

(async () => {
  const c = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const sens = (await c.query(`select id, word, meaning from word_master where sensitive is not null`)).rows;
  const sensIds = new Set(sens.map(r => Number(r.id)));
  const sensMeanings = new Set(sens.map(r => r.meaning));

  // 동의어 그룹: word_master_id → group_code
  const syn = (await c.query(`select group_code, word_master_id from synonym_groups where word_master_id is not null`)).rows;
  const groupOf = new Map(syn.map(r => [Number(r.word_master_id), r.group_code]));

  // 교체 대상: 민감 어휘를 오답 보기로 가진 문항
  const targets = (await c.query(`
    select sw.id, sw.session_id, sw.word_master_id, sw.choices, w.word, w.meaning
    from session_words sw join word_master w on w.id = sw.word_master_id
    where w.sensitive is null and exists (
      select 1 from jsonb_array_elements(sw.choices) ch
      where (ch->>'is_correct')::boolean is not true and (ch->>'entry_id')::bigint in (select id from word_master where sensitive is not null))`)).rows;

  // 회차별 후보 어휘
  const sessIds = [...new Set(targets.map(t => t.session_id))];
  const pool = new Map();
  if (sessIds.length) {
    const rows = (await c.query(`
      select sw.session_id, w.id, w.word, w.meaning from session_words sw join word_master w on w.id = sw.word_master_id
      where sw.session_id = any($1) and w.sensitive is null`, [sessIds])).rows;
    rows.forEach(r => { if (!pool.has(r.session_id)) pool.set(r.session_id, []); pool.get(r.session_id).push(r); });
  }

  const plan = [];
  let fail = 0;
  for (const t of targets) {
    const choices = t.choices.map(x => ({ ...x }));
    const correct = choices.find(x => x.is_correct === true || x.is_correct === 'true');
    const used = new Set(choices.map(x => String(x.entry_id)));
    const usedText = new Set(choices.map(x => x.text));
    const myGroup = groupOf.get(Number(t.word_master_id));
    for (let i = 0; i < choices.length; i++) {
      const ch = choices[i];
      if (ch.is_correct === true || ch.is_correct === 'true') continue;
      if (!sensIds.has(Number(ch.entry_id))) continue;
      const cands = (pool.get(t.session_id) || []).filter(r =>
        Number(r.id) !== Number(t.word_master_id) && r.word !== t.word &&
        !used.has(String(r.id)) && !usedText.has(r.meaning) &&
        r.meaning !== (correct && correct.text) && !sensMeanings.has(r.meaning) &&
        !(myGroup && groupOf.get(Number(r.id)) === myGroup))
        .map(r => { const j = jaccard(correct ? correct.text : t.meaning, r.meaning); return { r, j, b: band(j) }; })
        .filter(x => x.b < 99)
        .sort((a, b) => a.b - b.b || Math.abs(a.j - 0.1) - Math.abs(b.j - 0.1));
      if (!cands.length) { fail++; console.log('후보 없음:', t.id, t.word); continue; }
      const pick = cands[0].r;
      const old = choices[i];
      choices[i] = { text: pick.meaning, entry_id: Number(pick.id), is_correct: false };
      used.add(String(pick.id)); usedText.add(pick.meaning);
      plan.push({ id: t.id, word: t.word, from: sens.find(s => Number(s.id) === Number(old.entry_id)).word, to: pick.word, before: t.choices, after: choices });
    }
    t.newChoices = choices;
  }

  const delRows = (await c.query(`
    select sw.*, w.word from session_words sw join word_master w on w.id = sw.word_master_id where w.sensitive is not null`)).rows;
  const fillHit = (await c.query(`
    select count(*)::int n from fill_pools fp where exists (select 1 from jsonb_object_keys(fp.pool) k where k::bigint = any($1))`, [[...sensIds]]).catch(() => ({ rows: [{ n: 'fill_pools 없음' }] }))).rows[0].n;

  console.log(`보기 교체 ${plan.length}곳 (후보 없음 ${fail}) / 회차 연결 삭제 ${delRows.length}개 / 빈칸 후보 정리 대상 ${fillHit}개 문항`);
  plan.slice(0, 15).forEach(p => console.log(`  [${p.word}] ${p.from} → ${p.to}`));
  if (plan.length > 15) console.log(`  ... 외 ${plan.length - 15}곳`);

  if (!APPLY) { await c.end(); return; }

  await c.query('begin');
  try {
    await c.query(`create table if not exists session_words_sensitive_bak_20261015 as select * from session_words where false`);
    await c.query(`insert into session_words_sensitive_bak_20261015 select sw.* from session_words sw join word_master w on w.id = sw.word_master_id where w.sensitive is not null`);
    await c.query(`create table if not exists session_words_choices_bak_sens_20261015 as select id, choices from session_words where false`);
    for (const t of targets) {
      if (JSON.stringify(t.newChoices) === JSON.stringify(t.choices)) continue;
      await c.query(`insert into session_words_choices_bak_sens_20261015 values ($1, $2)`, [t.id, JSON.stringify(t.choices)]);
      await c.query(`update session_words set choices = $2 where id = $1`, [t.id, JSON.stringify(t.newChoices)]);
      await c.query(`insert into admin_change_log(system, entity, entity_id, before_data, after_data, note) values ('word-sense','session_words',$1,$2,$3,$4)`,
        [String(t.id), JSON.stringify({ choices: t.choices }), JSON.stringify({ choices: t.newChoices }), NOTE + ' — 오답 보기 교체']);
    }
    const hasFill = (await c.query(`select to_regclass('public.fill_pools') is not null as ok`)).rows[0].ok;
    if (hasFill) {
      await c.query(`create table if not exists fill_pools_sens_bak_20261015 as select * from fill_pools where false`);
      await c.query(`insert into fill_pools_sens_bak_20261015 select * from fill_pools fp where exists (select 1 from jsonb_object_keys(fp.pool) k where k::bigint = any($1))`, [[...sensIds]]);
      await c.query(`update fill_pools fp set pool = fp.pool - $1::text[] where exists (select 1 from jsonb_object_keys(fp.pool) k where k::bigint = any($2))`, [[...sensIds].map(String), [...sensIds]]);
    }
    for (const r of delRows) {
      await c.query(`insert into admin_change_log(system, entity, entity_id, before_data, after_data, note) values ('word-sense','session_words',$1,$2,null,$3)`,
        [String(r.id), JSON.stringify({ session_id: r.session_id, word_master_id: r.word_master_id, word: r.word }), NOTE + ' — 회차 연결 삭제']);
    }
    await c.query(`delete from session_words sw using word_master w where w.id = sw.word_master_id and w.sensitive is not null`);
    await c.query('commit');
    console.log('적용 완료');
  } catch (e) { await c.query('rollback'); console.error('롤백:', e.message); process.exitCode = 1; }
  await c.end();
})();
