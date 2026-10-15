// 다음 한자사전 훈음(hanja_hun_ext_daum.json: {글자: "읽기1, 읽기2, ..."}) → hanja_hun_ext 표 (2026-10-16)
// 사용: DB_URL=... node db/load_hanja_hun_ext.js
const path = require('path');
const fs = require('fs');
const { Client } = require(path.join(__dirname, '../../sf-admin/node_modules/pg'));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'hanja_hun_ext_daum.json'), 'utf8'));

(async () => {
  const rows = [];
  for (const [ch, s] of Object.entries(data)) {
    if (!s) continue;
    const seen = new Set();
    s.split(',').map(x => x.replace(/\s+/g, ' ').trim()).filter(x => /\S+\s+\S+/.test(x)).forEach(h => {
      if (seen.has(h)) return;
      seen.add(h);
      rows.push([ch, seen.size, h]);
    });
  }
  const c = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('begin');
  try {
    await c.query(`delete from hanja_hun_ext where source = 'daum'`);
    for (let i = 0; i < rows.length; i += 500) {
      const part = rows.slice(i, i + 500);
      const vals = part.map((_, k) => `($${k * 3 + 1}, $${k * 3 + 2}, $${k * 3 + 3})`).join(',');
      await c.query(`insert into hanja_hun_ext(char, ord, hun) values ${vals}`, part.flat());
    }
    await c.query('commit');
    console.log('글자', Object.values(data).filter(Boolean).length, '/ 훈음 행', rows.length);
  } catch (e) { await c.query('rollback'); console.error('롤백:', e.message); process.exitCode = 1; }
  await c.end();
})();
