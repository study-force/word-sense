// ════════════════════════════════════════════════════════════════
// migrate.js — 훈감각 익히기 콘텐츠 엑셀 → DB 임포트 SQL 생성기 (v2)
//
// 최종본: 콘텐츠/훈감각_콘텐츠_최종본_YYYYMMDD.xlsx (박차장님 검토 최종본)
//
// v1(migrate_test.js) 대비 개선:
//   • word_master 를 (word, hanja) 복합키로 처리 → 동음이의어 보존 (핵심 버그 수정)
//   • session_words 를 (word, hanja)로 word_master에 연결 → 동음이의어 정확 매핑
//   • 변종 한자는 대표 표기(앞 2자)만 사용
//   • 임포트 전 정합성 검증 (주자 미포함 / word_master 미존재 행 리포트)
//   • 영역·회차 범위 지정 가능 (부분 임포트)
//
// 사용법:
//   cd db && npm install        (최초 1회 — xlsx 설치)
//   node migrate.js                         # 전체(6영역 1~50회차)
//   node migrate.js --area 생물 --from 3 --to 4   # 생물 3~4회차만
//   node migrate.js --out migrations/2026-10-07_full_import.sql
//
//   생성 SQL은 Supabase Studio SQL Editor에서 RUN (운영/개발).
//   idempotent (ON CONFLICT) 이라 재실행 안전.
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// ─ 설정 ─────────────────────────────────────────
const EXCEL_PATH = path.resolve(__dirname, '../콘텐츠/훈감각_콘텐츠_최종본_20261007.xlsx');

const AREA_SLUG = {
  '생물': 'biology', '사회': 'society', '역사': 'history',
  '과학': 'science', '문화': 'culture', '경제': 'economy',
};
const AREAS = Object.keys(AREA_SLUG);

// ─ CLI 인자 ─
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return (i > -1 && process.argv[i + 1]) ? process.argv[i + 1] : def;
}
const FILTER_AREA = arg('area', null);              // null = 전체
const FROM_ROUND  = arg('from', null) ? Number(arg('from')) : null;
const TO_ROUND    = arg('to', null) ? Number(arg('to')) : null;
const OUT_PATH    = path.resolve(__dirname, arg('out', 'migration_generated.sql'));

// ─ 유틸 ─────────────────────────────────────────
const str = v => (v == null ? '' : String(v)).normalize('NFC').trim();
// 한자 추출 — CJK 호환 한자(U+F900~, 예: 落 U+F918)를 NFKC로 표준 한자로 변환 후 추출.
// (엑셀에 호환 한자가 섞여 있어 정규화 없이는 主字 파싱/어휘 매칭이 깨짐)
const onlyHanja = s => (str(s).normalize('NFKC').match(/[㐀-䶿一-鿿]/g) || []).join('');
const primaryHanja = s => onlyHanja(s).slice(0, 2);   // 변종 → 대표 표기(앞 2자)
const esc = s => str(s).replace(/'/g, "''");
const jsonEsc = o => JSON.stringify(o).replace(/'/g, "''");
const inRange = r => (FROM_ROUND == null || r >= FROM_ROUND) && (TO_ROUND == null || r <= TO_ROUND);

// ─ 엑셀 로드 ─
if (!fs.existsSync(EXCEL_PATH)) { console.error('엑셀 없음:', EXCEL_PATH); process.exit(1); }
const wb = XLSX.readFile(EXCEL_PATH, { cellDates: false });
const sheet = name => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false });

// ─ 1. 뜻퀴즈_사전 → word_master (키: word|hanja) ──
// 컬럼: 0어휘 1한자 2훈음1 3훈음2 4등급 5정답(의미)
function parseWordMaster() {
  const rows = sheet('뜻퀴즈_사전');
  const map = new Map();           // word|hanja → {...}
  const variants = [];             // 변종 한자 발견 로그
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    const word = str(r[0]);
    const rawHanja = str(r[1]);
    const hanja = primaryHanja(rawHanja);
    if (!word || !hanja) continue;
    if (onlyHanja(rawHanja).length > 2) variants.push(`${word}: ${rawHanja} → ${hanja}`);
    map.set(word + '|' + hanja, {
      word, hanja,
      char1: hanja[0] || '', hun1: str(r[2]),
      char2: hanja[1] || '', hun2: str(r[3]),
      grade: r[4] != null && str(r[4]) !== '' ? Number(r[4]) : null,
      meaning: str(r[5]),
    });
  }
  return { map, variants };
}

// ─ 2. 회차별 主字 → sessions 메타 (키: area|round) ──
// 컬럼: 0영역 1회차 2主字 3훈음 10어원풀이(K) 11의미카드(L)
function parseMainMeanings(raw) {
  const text = str(raw);
  if (!text) return [];
  return text.split(/\[\d+\]/).map(s => s.trim()).filter(Boolean).map(item => {
    const parts = item.split('→').map(s => s.trim());
    if (parts.length === 2) {
      return { hun: parts[0], examples: parts[1].split(/[,，]/).map(s => s.trim()).filter(Boolean) };
    }
    return { hun: item, examples: [] };
  });
}
function parseSessionMeta() {
  const rows = sheet('회차별 主字');
  const map = new Map();
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    const rawArea = str(r[0]);
    const area = AREAS.find(a => rawArea.includes(a));
    const round = Number(str(r[1]));
    const mainChar = onlyHanja(r[2]).slice(0, 1);
    if (!area || !round || !mainChar) continue;
    const hun = str(r[3]);                       // "날 생"
    const meanings = parseMainMeanings(r[11]);   // L: 의미 카드
    map.set(area + '|' + round, {
      area, round, mainChar,
      mainCharHangul: hun,
      mainHunShort: hun.split(/\s+/)[0] || '',
      mainEum: meanings.map(m => m.hun).join(' · '),
      etymology: str(r[10]),                     // K: 어원 풀이
      meanings,
    });
  }
  return map;
}

// ─ 3. 영역 시트 → session_words (word+hanja로 word_master 연결) ──
// 컬럼: 0회차 1主字 3순번 5어휘 6한자 7정답 10오답1표시 13오답2표시 16오답3표시 17빈칸문장
function parseAreaWords(area) {
  const rows = sheet(area);
  const out = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    const round = Number(str(r[0]));
    const word = str(r[5]);
    const hanja = primaryHanja(r[6]);
    if (!round || !word || !hanja) continue;
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

// ─ 실행 ─────────────────────────────────────────
console.error('엑셀:', EXCEL_PATH);
console.error('범위:', FILTER_AREA || '전체 영역', FROM_ROUND || 1, '~', TO_ROUND || 50, '회차\n');

const { map: wordMaster, variants } = parseWordMaster();
const sessionMeta = parseSessionMeta();
console.error('word_master:', wordMaster.size, '개 | 변종한자 대표표기 처리:', variants.length, '건');
console.error('session meta:', sessionMeta.size, '회차');

// session_words 수집 (범위 필터)
const targetAreas = FILTER_AREA ? [FILTER_AREA] : AREAS;
const byRound = new Map();   // area|round → [words]
let totalWords = 0;
const dupSkipped = [];
targetAreas.forEach(area => {
  parseAreaWords(area).forEach(w => {
    if (!inRange(w.round)) return;
    const key = area + '|' + w.round;
    if (!byRound.has(key)) byRound.set(key, []);
    const arr = byRound.get(key);
    const wk = w.word + '|' + w.hanja;
    // 회차 내 중복 (word, 대표한자) 제거 — 변종표기 등으로 같은 어휘가 두 번 들어가는 것 방지
    if (arr.some(function(x){ return x.word + '|' + x.hanja === wk; })) {
      dupSkipped.push(area + w.round + ' ' + wk);
      return;
    }
    arr.push(w);
    totalWords++;
  });
});
console.error('대상 회차:', byRound.size, '| 대상 어휘행:', totalWords);
if (dupSkipped.length) console.error('회차 내 중복 제거:', dupSkipped.length, '건 →', dupSkipped.join(', '));

// ── 정합성 검증 ──
const errMissingWM = [];   // word_master에 없는 (word,hanja)
const errNoMeta = [];      // 메타 없는 회차
const errMainChar = [];    // 主字 미포함
byRound.forEach((words, key) => {
  if (!sessionMeta.has(key)) errNoMeta.push(key);
  words.forEach(w => {
    if (!wordMaster.has(w.word + '|' + w.hanja)) errMissingWM.push(`${w.area}${w.round} ${w.word}(${w.hanja})`);
    if (w.mainChar && !w.hanja.includes(w.mainChar)) errMainChar.push(`${w.area}${w.round}(${w.mainChar}) ${w.word}(${w.hanja})`);
  });
});
console.error('\n── 정합성 ──');
console.error('word_master 미존재:', errMissingWM.length);
console.error('메타 없는 회차:', errNoMeta.length);
console.error('主字 미포함:', errMainChar.length);
if (errMissingWM.length) console.error('  (미존재 샘플)', errMissingWM.slice(0, 10).join(', '));
if (errNoMeta.length) console.error('  (메타없음)', errNoMeta.join(', '));
if (errMainChar.length) console.error('  (主字미포함 샘플)', errMainChar.slice(0, 10).join(', '));

// ── 동음이의어 카운트 (대상 범위 내) ──
const homonymSlots = [];
byRound.forEach((words, key) => {
  const byWord = new Map();
  words.forEach(w => { if (!byWord.has(w.word)) byWord.set(w.word, new Set()); byWord.get(w.word).add(w.hanja); });
  byWord.forEach((hs, w) => { if (hs.size > 1) homonymSlots.push(`${key} ${w}:${[...hs].join('/')}`); });
});
console.error('\n연속 퀴즈(같은 회차 2뜻+) 슬롯:', homonymSlots.length);

// ── SQL 생성 ──
const L = [];
L.push('-- ════════════════════════════════════════════════════════════════');
L.push(`-- 콘텐츠 임포트 — ${FILTER_AREA || '전체'} / ${FROM_ROUND || 1}~${TO_ROUND || 50}회차`);
L.push(`-- 생성: ${new Date().toISOString()}  |  원본: ${path.basename(EXCEL_PATH)}`);
L.push(`-- word_master ${wordMaster.size} · 회차 ${byRound.size} · 어휘행 ${totalWords}`);
L.push('-- (word,hanja) 복합키 · 변종 대표표기 · idempotent');
L.push('-- ════════════════════════════════════════════════════════════════');
L.push('BEGIN;\n');

// 1) word_master — upsert
//    전체 임포트: 전체 SSOT(4,430) / 부분 임포트: 대상 회차가 참조하는 어휘만 (SQL 경량화)
const isPartial = !!(FILTER_AREA || FROM_ROUND != null || TO_ROUND != null);
const refKeys = new Set();
byRound.forEach(words => words.forEach(w => refKeys.add(w.word + '|' + w.hanja)));
const wmArr = isPartial
  ? [...wordMaster.values()].filter(w => refKeys.has(w.word + '|' + w.hanja))
  : [...wordMaster.values()];
L.push(`-- 1) word_master upsert (ON CONFLICT (word,hanja)) — ${isPartial ? '대상 회차 참조 어휘만 ' + wmArr.length + '개' : '전체 SSOT ' + wmArr.length + '개'}`);
const BATCH = 500;
for (let i = 0; i < wmArr.length; i += BATCH) {
  const batch = wmArr.slice(i, i + BATCH);
  L.push('INSERT INTO word_master (word, hanja, char1, hun1, char2, hun2, meaning, grade) VALUES');
  L.push(batch.map(w =>
    `  ('${esc(w.word)}','${esc(w.hanja)}','${esc(w.char1)}','${esc(w.hun1)}','${esc(w.char2)}','${esc(w.hun2)}','${esc(w.meaning)}',${w.grade == null ? 'NULL' : w.grade})`
  ).join(',\n'));
  L.push('ON CONFLICT (word, hanja) DO UPDATE SET');
  L.push('  char1=EXCLUDED.char1, hun1=EXCLUDED.hun1, char2=EXCLUDED.char2, hun2=EXCLUDED.hun2,');
  L.push('  meaning=EXCLUDED.meaning, grade=EXCLUDED.grade, updated_at=NOW();\n');
}

// 2) sessions + session_words (회차별)
const keys = [...byRound.keys()].sort((a, b) => {
  const [aa, ar] = a.split('|'), [ba, br] = b.split('|');
  return aa.localeCompare(ba) || Number(ar) - Number(br);
});
keys.forEach(key => {
  const words = byRound.get(key);
  const meta = sessionMeta.get(key);
  if (!meta) { L.push(`-- ⚠️ 메타 없음, 건너뜀: ${key}`); return; }
  const slug = AREA_SLUG[meta.area];
  L.push(`-- ── ${meta.area} ${meta.round}회차 (${meta.mainChar} · ${meta.mainCharHangul}) · 어휘 ${words.length} ──`);
  // session upsert
  L.push('INSERT INTO sessions (area_id, round_no, main_char, main_char_hangul, main_hun_short, main_eum, main_etymology, main_meanings, total_words) VALUES (');
  L.push(`  (SELECT id FROM areas WHERE slug='${slug}'), ${meta.round}, '${esc(meta.mainChar)}', '${esc(meta.mainCharHangul)}', '${esc(meta.mainHunShort)}',`);
  L.push(`  '${esc(meta.mainEum)}', '${esc(meta.etymology)}', '${jsonEsc(meta.meanings)}'::jsonb, ${words.length}`);
  L.push(') ON CONFLICT (area_id, round_no) DO UPDATE SET');
  L.push('  main_char=EXCLUDED.main_char, main_char_hangul=EXCLUDED.main_char_hangul, main_hun_short=EXCLUDED.main_hun_short,');
  L.push('  main_eum=EXCLUDED.main_eum, main_etymology=EXCLUDED.main_etymology, main_meanings=EXCLUDED.main_meanings,');
  L.push('  total_words=EXCLUDED.total_words, updated_at=NOW();');
  // 기존 session_words 전체 교체
  L.push(`DELETE FROM session_words WHERE session_id = (SELECT id FROM sessions WHERE area_id=(SELECT id FROM areas WHERE slug='${slug}') AND round_no=${meta.round});`);
  words.forEach((w, idx) => {
    L.push('INSERT INTO session_words (session_id, word_master_id, fill_sentence, choices, is_infer_quiz, order_in_session)');
    L.push(`SELECT s.id, wm.id, '${esc(w.fill)}', '${jsonEsc(w.choices)}'::jsonb, false, ${w.order || idx + 1}`);
    L.push(`FROM sessions s, word_master wm`);
    L.push(`WHERE s.area_id=(SELECT id FROM areas WHERE slug='${slug}') AND s.round_no=${meta.round} AND wm.word='${esc(w.word)}' AND wm.hanja='${esc(w.hanja)}'`);
    L.push(`ON CONFLICT (session_id, word_master_id) DO NOTHING;`);
  });
  L.push('');
});

L.push('COMMIT;');
L.push('');
L.push('-- ── 검증 쿼리 ──');
L.push("SELECT a.name_ko, s.round_no, s.main_char, s.total_words, COUNT(sw.id) AS actual");
L.push('FROM sessions s JOIN areas a ON a.id=s.area_id LEFT JOIN session_words sw ON sw.session_id=s.id');
L.push('GROUP BY a.name_ko, s.round_no, s.main_char, s.total_words ORDER BY a.name_ko, s.round_no;');

fs.writeFileSync(OUT_PATH, L.join('\n'), 'utf8');
console.error('\n✅ SQL 생성 →', OUT_PATH, `(${(fs.statSync(OUT_PATH).size / 1024).toFixed(0)} KB)`);
if (errMissingWM.length) console.error('⚠️ word_master 미존재 행이 있어 해당 어휘는 삽입 안 됨 — 확인 필요');
