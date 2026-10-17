// 홈페이지 랭킹판 만들기 — db/ranking/ranking.tpl.html 의 자리표시(__DEV_URL__ 등)에
// data-supabase.js 의 테섭·운영 주소/공개키를 넣어 루트의 ranking.html 로 씀
//   실행: cd word-sense && node db/ranking/build.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(root, 'data-supabase.js'), 'utf8');
function g(n) {
  const i = src.indexOf('const ' + n + ' ');
  if (i < 0) throw new Error('없음 ' + n);
  const a = src.indexOf("'", i) + 1, b = src.indexOf("'", a);
  return src.slice(a, b);
}
let t = fs.readFileSync(path.join(__dirname, 'ranking.tpl.html'), 'utf8');
t = t.replace('__DEV_URL__', g('DEV_SUPABASE_URL')).replace('__PROD_URL__', g('PROD_SUPABASE_URL'))
     .replace('__DEV_KEY__', g('DEV_SUPABASE_ANON_KEY')).replace('__PROD_KEY__', g('PROD_SUPABASE_ANON_KEY'));
fs.writeFileSync(path.join(root, 'ranking.html'), t);
console.log('ok, 남은 자리표시:', /__(DEV|PROD)_/.test(t));
