// ════════════════════════════════════════════════════════════════
// migrate.js — 훈감각 익히기 콘텐츠 엑셀 → DB 임포트 SQL 생성기 (v3, 학제 지원)
//
// 학제(level): 초등 / 중등 — 같은 DB에 공존 (sessions.level + UNIQUE(area,round,level))
//
// 사용법:
//   cd db && npm install                      # 최초 1회 (xlsx)
//   node migrate.js                           # 초등 전체
//   node migrate.js --level 중등              # 중등 전체
//   node migrate.js --area 생물 --from 3 --to 4
//   node migrate.js --level 중등 --out migrations/xxx.sql
//   (생성 SQL은 psql -f 또는 Supabase Studio. idempotent.)
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// ─ CLI ─
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return (i > -1 && process.argv[i + 1]) ? process.argv[i + 1] : def;
}
const LEVEL       = arg('level', '초등');            // 초등 | 중등
const IS_MID      = LEVEL === '중등';
const FILTER_AREA = arg('area', null);
const FROM_ROUND  = arg('from', null) ? Number(arg('from')) : null;
const TO_ROUND    = arg('to', null) ? Number(arg('to')) : null;
const OUT_PATH    = path.resolve(__dirname, arg('out', 'migration_generated.sql'));

// ─ 학제별 설정 ─
const EXCEL_PATH = path.resolve(__dirname, IS_MID
  ? '../콘텐츠/훈감각_중등_최종본_20261008.xlsx'
  : '../콘텐츠/훈감각_콘텐츠_최종본_20261007.xlsx');
const DICT_SHEET = IS_MID ? '중학사전' : '뜻퀴즈_사전';
// 사전 컬럼 (중등은 A:No가 앞에 있어 한 칸씩 밀림)
const DC = IS_MID
  ? { word: 1, hanja: 2, hun1: 3, hun2: 4, grade: 5, meaning: 6 }
  : { word: 0, hanja: 1, hun1: 2, hun2: 3, grade: 4, meaning: 5 };
// 회차별主字: 초등은 K(어원)/L(의미카드) 있음, 중등은 없음(도입 어원은 공통 主字=초등 재사용/추후)
const HAS_META_ETY = !IS_MID;
// 중등 제외 어휘 — 공생/기생/생식은 초등 어휘로 유지 (중등에서 빼고, 초등 word_master 덮어쓰기 방지)
const EXCLUDE = IS_MID ? new Set(['공생|共生', '기생|寄生', '생식|生食']) : new Set();
// word_master 충돌: 초등=덮어씀 / 중등=기존(초등) 보존
const WM_CONFLICT = IS_MID
  ? 'ON CONFLICT (word, hanja) DO NOTHING;'
  : ['ON CONFLICT (word, hanja) DO UPDATE SET',
     '  char1=EXCLUDED.char1, hun1=EXCLUDED.hun1, char2=EXCLUDED.char2, hun2=EXCLUDED.hun2,',
     '  meaning=EXCLUDED.meaning, grade=EXCLUDED.grade, updated_at=NOW();'].join('\n');

const AREA_SLUG = {
  '생물': 'biology', '사회': 'society', '역사': 'history',
  '과학': 'science', '문화': 'culture', '경제': 'economy',
};
const AREAS = Object.keys(AREA_SLUG);

// ─ 유틸 ─
const str = v => (v == null ? '' : String(v)).normalize('NFC').trim();
// CJK 호환 한자(U+F900~)를 NFKC로 표준화 후 추출
const onlyHanja = s => (str(s).normalize('NFKC').match(/[㐀-䶿一-鿿]/g) || []).join('');
const primaryHanja = s => onlyHanja(s).slice(0, 2);
const esc = s => str(s).replace(/'/g, "''");
const jsonEsc = o => JSON.stringify(o).replace(/'/g, "''");
const inRange = r => (FROM_ROUND == null || r >= FROM_ROUND) && (TO_ROUND == null || r <= TO_ROUND);
const LV = esc(LEVEL);

if (!fs.existsSync(EXCEL_PATH)) { console.error('엑셀 없음:', EXCEL_PATH); process.exit(1); }
const wb = XLSX.readFile(EXCEL_PATH, { cellDates: false });
const sheet = name => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false });

// ─ 1. 사전 → word_master ─
function parseWordMaster() {
  const rows = sheet(DICT_SHEET);
  const map = new Map();
  const variants = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    const word = str(r[DC.word]);
    const rawHanja = str(r[DC.hanja]);
    const hanja = primaryHanja(rawHanja);
    if (!word || !hanja) continue;
    if (EXCLUDE.has(word + '|' + hanja)) continue;   // 중등 제외 어휘
    if (onlyHanja(rawHanja).length > 2) variants.push(`${word}: ${rawHanja} → ${hanja}`);
    map.set(word + '|' + hanja, {
      word, hanja,
      char1: hanja[0] || '', hun1: str(r[DC.hun1]),
      char2: hanja[1] || '', hun2: str(r[DC.hun2]),
      grade: r[DC.grade] != null && str(r[DC.grade]) !== '' ? Number(r[DC.grade]) : null,
      meaning: str(r[DC.meaning]),
    });
  }
  return { map, variants };
}

// ─ 2. 회차별 主字 → sessions 메타 ─
function parseMainMeanings(raw) {
  const text = str(raw);
  if (!text) return [];
  return text.split(/\[\d+\]/).map(s => s.trim()).filter(Boolean).map(item => {
    const parts = item.split('→').map(s => s.trim());
    if (parts.length === 2) return { hun: parts[0], examples: parts[1].split(/[,，]/).map(s => s.trim()).filter(Boolean) };
    return { hun: item, examples: [] };
  });
}
function parseSessionMeta() {
  const rows = sheet('회차별 主字');
  const map = new Map();
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    const area = AREAS.find(a => str(r[0]).includes(a));
    const round = Number(str(r[1]));
    const mainChar = onlyHanja(r[2]).slice(0, 1);
    if (!area || !round || !mainChar) continue;
    const hun = str(r[3]);
    const meanings = HAS_META_ETY ? parseMainMeanings(r[11]) : [];
    map.set(area + '|' + round, {
      area, round, mainChar,
      mainCharHangul: hun,
      mainHunShort: hun.split(/\s+/)[0] || '',
      mainEum: meanings.map(m => m.hun).join(' · '),
      etymology: HAS_META_ETY ? str(r[10]) : '',   // 중등은 비움 (공통 主字는 추후 초등 재사용)
      meanings,
    });
  }
  return map;
}

// ─ 3. 영역 시트 → session_words (초등/중등 컬럼 동일 A~R) ─
function parseAreaWords(area) {
  const rows = sheet(area);
  const out = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    const round = Number(str(r[0]));
    const word = str(r[5]);
    const hanja = primaryHanja(r[6]);
    if (!round || !word || !hanja) continue;
    if (EXCLUDE.has(word + '|' + hanja)) continue;   // 중등 제외 어휘
    const choices = [{ text: str(r[7]), is_correct: true }];
    [10, 13, 16].forEach(c => { const t = str(r[c]); if (t) choices.push({ text: t, is_correct: false }); });
    out.push({
      area, round, word, hanja,
      mainChar: onlyHanja(r[1]).slice(0, 1),
      order: str(r[3]) ? Number(r[3]) : null,
      fill: str(r[17]),
      choices,
    });
  }
  return out;
}

// ─ 실행 ─
console.error('학제:', LEVEL, '| 엑셀:', path.basename(EXCEL_PATH));
console.error('범위:', FILTER_AREA || '전체 영역', FROM_ROUND || 1, '~', TO_ROUND || 50, '회차\n');

const { map: wordMaster, variants } = parseWordMaster();
const sessionMeta = parseSessionMeta();
console.error('word_master:', wordMaster.size, '개 | 변종한자 처리:', variants.length, '건');
console.error('session meta:', sessionMeta.size, '회차', HAS_META_ETY ? '' : '(중등 — 어원/의미카드 비움)');

const targetAreas = FILTER_AREA ? [FILTER_AREA] : AREAS;
const byRound = new Map();
let totalWords = 0;
const dupSkipped = [];
targetAreas.forEach(area => {
  parseAreaWords(area).forEach(w => {
    if (!inRange(w.round)) return;
    const key = area + '|' + w.round;
    if (!byRound.has(key)) byRound.set(key, []);
    const arr = byRound.get(key);
    const wk = w.word + '|' + w.hanja;
    if (arr.some(x => x.word + '|' + x.hanja === wk)) { dupSkipped.push(area + w.round + ' ' + wk); return; }
    arr.push(w);
    totalWords++;
  });
});
console.error('대상 회차:', byRound.size, '| 대상 어휘행:', totalWords);
if (dupSkipped.length) console.error('회차 내 중복 제거:', dupSkipped.length, '건 →', dupSkipped.join(', '));
if (EXCLUDE.size) console.error('제외 어휘(초등 유지):', [...EXCLUDE].join(', '));

// ── 정합성 ──
const errMissingWM = [], errNoMeta = [], errMainChar = [];
byRound.forEach((words, key) => {
  if (!sessionMeta.has(key)) errNoMeta.push(key);
  words.forEach(w => {
    if (!wordMaster.has(w.word + '|' + w.hanja)) errMissingWM.push(`${w.area}${w.round} ${w.word}(${w.hanja})`);
    if (w.mainChar && !w.hanja.includes(w.mainChar)) errMainChar.push(`${w.area}${w.round}(${w.mainChar}) ${w.word}(${w.hanja})`);
  });
});
console.error('\n── 정합성 ──');
console.error('word_master 미존재:', errMissingWM.length, errMissingWM.length ? '→ ' + errMissingWM.slice(0, 10).join(', ') : '');
console.error('메타 없는 회차:', errNoMeta.length, errNoMeta.length ? '→ ' + errNoMeta.join(', ') : '');
console.error('主字 미포함:', errMainChar.length, errMainChar.length ? '→ ' + errMainChar.slice(0, 10).join(', ') : '');

const homonymSlots = [];
byRound.forEach(words => {
  const bw = new Map();
  words.forEach(w => { if (!bw.has(w.word)) bw.set(w.word, new Set()); bw.get(w.word).add(w.hanja); });
  bw.forEach(hs => { if (hs.size > 1) homonymSlots.push(1); });
});
console.error('연속 퀴즈 슬롯:', homonymSlots.length);

// ── SQL 생성 ──
const L = [];
L.push('-- ════════════════════════════════════════════════════════════════');
L.push(`-- 콘텐츠 임포트 [${LEVEL}] — ${FILTER_AREA || '전체'} / ${FROM_ROUND || 1}~${TO_ROUND || 50}회차`);
L.push(`-- 생성: ${new Date().toISOString()}  |  원본: ${path.basename(EXCEL_PATH)}`);
L.push(`-- word_master ${wordMaster.size} · 회차 ${byRound.size} · 어휘행 ${totalWords}`);
L.push('BEGIN;\n');

// 1) word_master
const isPartial = !!(FILTER_AREA || FROM_ROUND != null || TO_ROUND != null);
const refKeys = new Set();
byRound.forEach(words => words.forEach(w => refKeys.add(w.word + '|' + w.hanja)));
const wmArr = isPartial
  ? [...wordMaster.values()].filter(w => refKeys.has(w.word + '|' + w.hanja))
  : [...wordMaster.values()];
L.push(`-- 1) word_master upsert (${IS_MID ? '중등 — 기존 초등 보존 DO NOTHING' : '초등 — DO UPDATE'}) ${wmArr.length}개`);
const BATCH = 500;
for (let i = 0; i < wmArr.length; i += BATCH) {
  const batch = wmArr.slice(i, i + BATCH);
  L.push('INSERT INTO word_master (word, hanja, char1, hun1, char2, hun2, meaning, grade) VALUES');
  L.push(batch.map(w =>
    `  ('${esc(w.word)}','${esc(w.hanja)}','${esc(w.char1)}','${esc(w.hun1)}','${esc(w.char2)}','${esc(w.hun2)}','${esc(w.meaning)}',${w.grade == null ? 'NULL' : w.grade})`
  ).join(',\n'));
  L.push(WM_CONFLICT + '\n');
}

// 2) sessions + session_words (학제 반영)
const keys = [...byRound.keys()].sort((a, b) => {
  const [aa, ar] = a.split('|'), [ba, br] = b.split('|');
  return aa.localeCompare(ba) || Number(ar) - Number(br);
});
const sidSub = (slug, round) => `(SELECT id FROM sessions WHERE area_id=(SELECT id FROM areas WHERE slug='${slug}') AND round_no=${round} AND level='${LV}')`;
keys.forEach(key => {
  const words = byRound.get(key);
  const meta = sessionMeta.get(key);
  if (!meta) { L.push(`-- ⚠️ 메타 없음, 건너뜀: ${key}`); return; }
  const slug = AREA_SLUG[meta.area];
  L.push(`-- ── [${LEVEL}] ${meta.area} ${meta.round}회차 (${meta.mainChar} · ${meta.mainCharHangul}) · 어휘 ${words.length} ──`);
  L.push('INSERT INTO sessions (area_id, round_no, level, main_char, main_char_hangul, main_hun_short, main_eum, main_etymology, main_meanings, total_words) VALUES (');
  L.push(`  (SELECT id FROM areas WHERE slug='${slug}'), ${meta.round}, '${LV}', '${esc(meta.mainChar)}', '${esc(meta.mainCharHangul)}', '${esc(meta.mainHunShort)}',`);
  L.push(`  '${esc(meta.mainEum)}', '${esc(meta.etymology)}', '${jsonEsc(meta.meanings)}'::jsonb, ${words.length}`);
  L.push(') ON CONFLICT (area_id, round_no, level) DO UPDATE SET');
  L.push('  main_char=EXCLUDED.main_char, main_char_hangul=EXCLUDED.main_char_hangul, main_hun_short=EXCLUDED.main_hun_short,');
  L.push('  main_eum=EXCLUDED.main_eum, main_etymology=EXCLUDED.main_etymology, main_meanings=EXCLUDED.main_meanings,');
  L.push('  total_words=EXCLUDED.total_words, updated_at=NOW();');
  L.push(`DELETE FROM session_words WHERE session_id = ${sidSub(slug, meta.round)};`);
  words.forEach((w, idx) => {
    L.push('INSERT INTO session_words (session_id, word_master_id, fill_sentence, choices, is_infer_quiz, order_in_session)');
    L.push(`SELECT s.id, wm.id, '${esc(w.fill)}', '${jsonEsc(w.choices)}'::jsonb, false, ${w.order || idx + 1}`);
    L.push(`FROM sessions s, word_master wm`);
    L.push(`WHERE s.area_id=(SELECT id FROM areas WHERE slug='${slug}') AND s.round_no=${meta.round} AND s.level='${LV}' AND wm.word='${esc(w.word)}' AND wm.hanja='${esc(w.hanja)}'`);
    L.push(`ON CONFLICT (session_id, word_master_id) DO NOTHING;`);
  });
  L.push('');
});

L.push('COMMIT;');
L.push('');
L.push('-- ── 검증 ──');
L.push(`SELECT a.name_ko, s.level, COUNT(DISTINCT s.round_no) AS rounds, COUNT(sw.id) AS words`);
L.push(`FROM sessions s JOIN areas a ON a.id=s.area_id LEFT JOIN session_words sw ON sw.session_id=s.id`);
L.push(`WHERE s.level='${LV}' GROUP BY a.name_ko, s.level ORDER BY a.name_ko;`);

fs.writeFileSync(OUT_PATH, L.join('\n'), 'utf8');
console.error('\n✅ SQL 생성 →', OUT_PATH, `(${(fs.statSync(OUT_PATH).size / 1024).toFixed(0)} KB)`);
if (errMissingWM.length) console.error('⚠️ word_master 미존재 행 있음 — 해당 어휘 삽입 안 됨');
