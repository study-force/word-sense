// build_dict_root.js — 표준국어대사전 .xls → 어근(혼자 안 쓰이는 말) 룩업 추출
//
// 배경 (대표님 2026-10-14): '생생'처럼 국립국어원이 단어가 아닌 「어근」으로 보는 말은
//   '생생하다'·'생생히'로만 쓰이고 혼자서는 안 쓰임. 학생이 입력하면 "사전에 없어요" 대신 그 쓰임을 알려주기 위함.
//
// 입력: 콘텐츠/표준국어대사전_20260504/*.xls
// 출력: db/dict_root_stdict.csv (word,hanja,forms)   forms = 사전에 있는 파생어 목록(| 구분)
//
// 필터:
//   ✅ 한글 2음절 · 구성 단위 "단어" · 품사 「품사 없음」(= 어근)
//   ❌ 방언·옛말·북한어 등 제외
//   ✅ 파생어(어근+하다/히/스럽다/롭다/거리다/대다/이다) 중 사전에 실제로 있는 것이 1개 이상일 때만

const fs   = require('fs');
const XLSX = require('C:/Users/이재훈/Desktop/CLAUDE/node_modules/xlsx');

const DICT_DIR   = 'C:/Users/이재훈/Desktop/CLAUDE/word-sense/콘텐츠/표준국어대사전_20260504';
const OUTPUT_CSV = 'C:/Users/이재훈/Desktop/CLAUDE/word-sense/db/dict_root_stdict.csv';

const TWO_HANGUL = /^[가-힣]{2}$/;
const SUFFIXES = ['하다', '히', '스럽다', '롭다', '거리다', '대다', '이다'];
const EXCLUDE_CATEGORIES = ['방언', '옛말', '고어', '북한어', '비표준어'];
const HANJA_RE = /[一-鿿㐀-䶿]/g;
const clean = (s) => String(s || '').replace(/[-^0-9\s]/g, '').trim();
const hanjaOf = (s) => (String(s || '').match(HANJA_RE) || []).join('');

const roots = new Map();     // word → hanja
const allWords = new Map();  // word → 원어(파생어 한자 보충용)

for (const f of fs.readdirSync(DICT_DIR).filter((f) => f.endsWith('.xls'))) {
  const wb = XLSX.readFile(DICT_DIR + '/' + f);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  for (const r of rows) {
    const w = clean(r['어휘']);
    if (!w) continue;
    const cat = String(r['범주'] || '');
    if (EXCLUDE_CATEGORIES.some((k) => cat.includes(k))) continue;
    if (!allWords.has(w)) allWords.set(w, String(r['원어'] || ''));
    const unit = String(r['구성 단위'] || '').trim();
    const pumsa = String(r['품사'] || '');
    if (TWO_HANGUL.test(w) && unit === '단어' && pumsa.includes('「품사 없음」')) {
      if (!roots.has(w) || !roots.get(w)) roots.set(w, hanjaOf(r['원어']));
    }
  }
  console.log('읽음', f, '누적 어근', roots.size);
}

const lines = ['word,hanja,forms'];
let kept = 0;
for (const [w, h] of roots) {
  const forms = SUFFIXES.map((s) => w + s).filter((x) => allWords.has(x));
  if (!forms.length) continue;
  // 어근에 원어가 없으면 'X하다'의 원어에서 한자 보충 (예: 堂堂하다 → 堂堂)
  const hanja = h || hanjaOf(allWords.get(w + '하다'));
  lines.push([w, hanja, forms.join('|')].join(','));
  kept++;
}
fs.writeFileSync(OUTPUT_CSV, lines.join('\n') + '\n', 'utf8');
console.log('완료 — 어근', kept, '개 →', OUTPUT_CSV);
