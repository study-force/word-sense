// 빈칸 문장(session_words.fill_sentence) 격식체 → 해요체 전수 변환 (대표님 2026-10-16)
//   · 끝 글자 받침이 ㅆ/ㅄ인 '-다'(했다·갔다·있다·없다·겠다…)는 규칙으로: 다 → 어요
//   · 나머지(한다·이다·크다·-자·-니? 등)는 사람이 쓴 변환표(haeyo/out_*.json)를 사용
//   · 검사: 빈칸(___) 개수 그대로 / 바뀐 곳은 문장 끝부분만 / 결과가 요(?!.)로 끝남
//   · 테섭 DB에만 적용 (운영은 sf-admin '운영에 반영'으로). 원본은 백업 표에 보관, 변경이력 1건
// 사용: DB_URL=$DEV_DB_URL node db/haeyo_fill_sentences_20261016.js <haeyo 폴더> [--apply] [--xlsx 출력.xlsx]
const path = require('path');
const fs = require('fs');
const { Client } = require(path.join(__dirname, '../../sf-admin/node_modules/pg'));
const DIR = process.argv[2];
const APPLY = process.argv.includes('--apply');
const xi = process.argv.indexOf('--xlsx');
const XLSX_OUT = xi > -1 ? process.argv[xi + 1] : null;

const jong = ch => { const c = ch.charCodeAt(0) - 0xAC00; return (c >= 0 && c < 11172) ? c % 28 : -1; };
function ruleConvert(s) {
  const m = s.match(/^(.*)(.)다([.!]?)$/);
  if (!m) return null;
  if (jong(m[2]) === 20 || m[2] === '없') return m[1] + m[2] + '어요' + m[3];
  return null;
}
// 바뀐 곳이 끝부분뿐인지: 공통 앞부분이 원문 길이에서 마지막 어절(+여유) 이내
function onlyEndingChanged(a, b) {
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const lastSpace = a.trimEnd().lastIndexOf(' ');
  return i >= Math.min(lastSpace + 1, a.length - 8);   // 마지막 어절 안에서만 바뀜(긴 어절 대비 여유 8자)
}

(async () => {
  const llm = new Map();
  for (let b = 1; b <= 6; b++) {
    const inp = JSON.parse(fs.readFileSync(path.join(DIR, `in_${b}.json`), 'utf8'));
    const out = JSON.parse(fs.readFileSync(path.join(DIR, `out_${b}.json`), 'utf8'));
    const byN = new Map(out.map(o => [o.n, o.s]));
    for (const r of inp) { if (!byN.has(r.n)) throw new Error(`out_${b}에 n=${r.n} 없음`); llm.set(r.s, byN.get(r.n)); }
  }

  const c = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const rows = (await c.query(`SELECT sw.id, sw.fill_sentence, s.level, a.name_ko area, s.round_no, w.word
                               FROM session_words sw JOIN sessions s ON s.id = sw.session_id JOIN areas a ON a.id = s.area_id
                               JOIN word_master w ON w.id = sw.word_master_id ORDER BY s.level, a.id, s.round_no, sw.id`)).rows;
  const plan = [], bad = [];
  let same = 0;
  for (const r of rows) {
    const o = r.fill_sentence;
    if (!o) continue;
    let n = /요[.?!]?["']?$/.test(o) ? o : (ruleConvert(o) || llm.get(o));
    if (n == null) { bad.push([r.id, o, '변환 없음']); continue; }
    if (n === o) { same++; continue; }
    const why = [];
    if ((o.match(/___/g) || []).length !== (n.match(/___/g) || []).length) why.push('빈칸 개수 다름');
    if (!/요[.?!]?["']?$/.test(n)) why.push('요로 안 끝남');
    if (!onlyEndingChanged(o, n)) why.push('끝 말고 다른 곳도 바뀜');
    if (why.length) { bad.push([r.id, o, n + '  ← ' + why.join(', ')]); continue; }
    plan.push({ ...r, n });
  }
  console.log(`전체 ${rows.length} / 바꿀 ${plan.length} / 이미 해요체 ${same} / 검사 걸림 ${bad.length}`);
  bad.slice(0, 40).forEach(b => console.log('  ✗', b.join(' | ')));
  plan.filter((_, i) => i % 700 === 0).forEach(p => console.log('  ', p.fill_sentence, '→', p.n));

  if (XLSX_OUT) {
    const XLSX = require(path.join(__dirname, 'node_modules/xlsx'));
    const wb = XLSX.utils.book_new();
    const sheet = (data, name) => {
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 6 }, { wch: 10 }, { wch: 60 }, { wch: 60 }];
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    sheet([['학제', '영역', '회차', '정답', '바꾸기 전', '바꾼 뒤']].concat(plan.map(p => [p.level, p.area, p.round_no, p.word, p.fill_sentence, p.n])), '바뀐 문장');
    if (bad.length) sheet([['id', '원문', '문제']].concat(bad), '검사 걸림');
    XLSX.writeFile(wb, XLSX_OUT);
    console.log('엑셀:', XLSX_OUT);
  }

  if (!APPLY) { await c.end(); return; }
  if (bad.length) { console.log('검사 걸린 문장이 있어 적용하지 않음'); await c.end(); process.exitCode = 1; return; }
  await c.query('BEGIN');
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS session_words_fill_haeyo_bak_20261016 AS SELECT id, fill_sentence FROM session_words WHERE false`);
    await c.query(`INSERT INTO session_words_fill_haeyo_bak_20261016 SELECT id, fill_sentence FROM session_words WHERE id = ANY($1)`, [plan.map(p => p.id)]);
    for (let i = 0; i < plan.length; i += 500) {
      const part = plan.slice(i, i + 500);
      await c.query(`UPDATE session_words sw SET fill_sentence = v.n FROM jsonb_to_recordset($1::jsonb) v(id bigint, o text, n text)
                     WHERE sw.id = v.id AND sw.fill_sentence = v.o`, [JSON.stringify(part.map(p => ({ id: p.id, o: p.fill_sentence, n: p.n })))]);
    }
    await c.query(`INSERT INTO admin_change_log (system, entity, entity_id, before_data, after_data, note)
                   VALUES ('word-sense', 'session_words', 'all', NULL, $1, $2)`,
      [JSON.stringify({ changed: plan.length, backup: 'session_words_fill_haeyo_bak_20261016' }), `빈칸 문장 격식체→해요체 전수 변환 ${plan.length}건`]);
    await c.query('COMMIT');
    console.log('적용 완료');
  } catch (e) { await c.query('ROLLBACK'); console.error('롤백:', e.message); process.exitCode = 1; }
  await c.end();
})();
