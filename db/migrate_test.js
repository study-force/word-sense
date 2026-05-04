// migrate_test.js — 검수전 Excel에서 1~2회차 데이터를 SQL로 변환
//
// 사용법: node db/migrate_test.js > db/migration_test.sql
//
// 입력: 콘텐츠/훈감각_사전콘텐츠_박차장님용_훈음추가.xlsx
// 출력: 1~2회차 import SQL (생물 영역만, 테스트용)
//
// ─ 처리 흐름 ────────────────────────────────────────
//   1. 뜻퀴즈_사전 시트 → word_master (4,432 어휘 SSOT)
//   2. 회차별 主字 시트 → sessions 메타 (主字, 어원, 다의)
//   3. 영역 시트(생물 등) → session_words (회차별 어휘 등장)
//
// ─ 테스트 범위 ──────────────────────────────────────
//   현재 TEST_AREA='생물', TEST_MAX_ROUND=2 → 생물 1, 2회차만 import
//   변경 시 위 두 변수 수정 (전체 import는 둘 다 null)

const fs = require('fs');
const ExcelJS = require('C:/Users/이재훈/AppData/Local/Temp/xlsx_mod/node_modules/exceljs');

const EXCEL_PATH = 'C:/Users/이재훈/Desktop/CLAUDE/word-sense/콘텐츠/훈감각_사전콘텐츠_박차장님용_어원음훈추가.xlsx';

// ─ 테스트 범위 (null = 전체) ──
const TEST_AREA = '생물';
const TEST_MAX_ROUND = 2;

const AREA_SLUG_MAP = {
  '생물': 'biology', '사회': 'society', '역사': 'history',
  '과학': 'science', '문화': 'culture', '경제': 'economy',
};

// SQL escape
const esc = s => (s == null ? '' : String(s)).replace(/'/g, "''");
const jsonEsc = s => esc(JSON.stringify(s));

// ─ 1. 뜻퀴즈_사전 파싱 → word_master 빌드 ──────────
function parseWordMaster(ws) {
  const out = new Map();
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const word    = row.getCell(1).value;          // A: 어휘
    const hanja   = row.getCell(2).value;          // B: 한자
    const hun1    = row.getCell(3).value;          // C: 첫 글자 훈음
    const hun2    = row.getCell(4).value;          // D: 둘째 글자 훈음
    const grade   = row.getCell(5).value;          // E: 등급
    const meaning = row.getCell(6).value;          // F: 정답 (의미 풀이)
    if (!word || !hanja) continue;

    const hanjaOnly = String(hanja).match(/[一-鿿]/g) || [];
    const c1 = hanjaOnly[0] || '';
    const c2 = hanjaOnly[1] || '';

    out.set(String(word), {
      word: String(word),
      hanja: String(hanja).replace(/[^一-鿿]/g, ''),  // 검수 표시(▽) 제거
      char1: c1, hun1: hun1 ? String(hun1) : '',
      char2: c2, hun2: hun2 ? String(hun2) : '',
      meaning: meaning ? String(meaning) : '',
      grade: grade ? Number(grade) : null,
    });
  }
  return out;
}

// ─ 2. 회차별 主字 파싱 → 회차 메타 ──────────────
// 컬럼 매핑 (어원추가본 기준):
//   A:영역 B:회차 C:主字 D:훈음 E~G:가족수
//   H:Wiktionary 어원 (학술용, 미사용)
//   I:검증상태 J:비고 (미사용)
//   K:어원 풀이 (페이지 노출) ⭐
//   L:의미 카드 (페이지 노출) ⭐
function parseSessionMeta(ws) {
  const out = new Map();
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const area      = row.getCell(1).value;
    const round     = row.getCell(2).value;
    const mainChar  = row.getCell(3).value;
    const mainHun   = row.getCell(4).value;
    const etymology = row.getCell(11).value;       // K: 어원 풀이 (페이지 노출)
    const meaningsRaw = row.getCell(12).value;     // L: 의미 카드 (페이지 노출)

    if (!area || !round || !mainChar) continue;

    const areaClean = String(area).replace(/[^\wㄱ-ㆎ가-힯]/g, '').trim();

    out.set(`${areaClean}-${round}`, {
      area: areaClean,
      round: Number(round),
      main_char: String(mainChar),
      main_char_hangul: mainHun ? String(mainHun) : '',
      main_hun_short: mainHun ? String(mainHun).split(' ')[0] : '',
      main_etymology: etymology ? String(etymology) : '',
      main_meanings: parseMainMeanings(meaningsRaw),
    });
  }
  return out;
}

// 박차장님 어원추가본 형식: "[1] 나다, 태어나다 → 출생, 탄생\n[2] ..."
//   → [{hun: "나다, 태어나다", examples: ["출생", "탄생"]}, ...]
function parseMainMeanings(raw) {
  if (!raw) return [];
  const text = String(raw);
  // [1] [2] [3] [4] 마커로 분할
  const items = text.split(/\[\d+\]/).map(s => s.trim()).filter(Boolean);
  return items.map(item => {
    // "나다, 태어나다 → 출생, 탄생" → 좌(의미)·우(예시) 분리
    const arrowSplit = item.split('→').map(s => s.trim());
    if (arrowSplit.length === 2) {
      return {
        hun: arrowSplit[0],
        examples: arrowSplit[1].split(/[,，]/).map(s => s.trim()).filter(Boolean),
      };
    }
    // 화살표 없으면 통째로 hun
    return { hun: item, examples: [] };
  });
}

// ─ 3. 영역 시트(생물 등) → 회차별 어휘 ──────────
function parseAreaSheet(ws, areaName) {
  const rows = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const round   = row.getCell(1).value;          // A: 회차
    const word    = row.getCell(6).value;          // F: 어휘 (정답)
    const correctMeaning = row.getCell(8).value;   // H: 정답 의미
    const wrong1  = row.getCell(11).value;         // K: 오답1 표시 (의미)
    const wrong2  = row.getCell(14).value;         // N: 오답2 표시
    const wrong3  = row.getCell(17).value;         // Q: 오답3 표시
    const fillSentence = row.getCell(18).value;    // R: 빈칸 문장

    if (!round || !word) continue;
    rows.push({
      area: areaName,
      round: Number(round),
      word: String(word),
      correctMeaning: correctMeaning ? String(correctMeaning) : '',
      wrong1: wrong1 ? String(wrong1) : '',
      wrong2: wrong2 ? String(wrong2) : '',
      wrong3: wrong3 ? String(wrong3) : '',
      fillSentence: fillSentence ? String(fillSentence) : '',
    });
  }
  return rows;
}

// ─ SQL 생성기 ───────────────────────────────────
function generateSQL(wordMaster, sessionMeta, sessionWordsByKey) {
  const out = [];
  out.push('-- ════════════════════════════════════════════════════════════════');
  out.push('-- 검수전 Excel → DB 마이그레이션 (테스트: ' +
    (TEST_AREA || '전체') + ' / 1~' + (TEST_MAX_ROUND || '50') + '회차)');
  out.push('-- 생성: ' + new Date().toISOString());
  out.push('-- ════════════════════════════════════════════════════════════════\n');

  // 1. word_master upsert (모든 4,432 어휘 — SSOT 유지)
  // 멀티-행 INSERT로 일괄 처리 (개별 INSERT 대비 ~30배 압축)
  out.push('-- 1. word_master upsert (전체 ' + wordMaster.size + '개 어휘 — 멀티-행 INSERT)');
  const allWords = [...wordMaster.values()];
  const BATCH_SIZE = 500;
  for (let i = 0; i < allWords.length; i += BATCH_SIZE) {
    const batch = allWords.slice(i, i + BATCH_SIZE);
    out.push(`INSERT INTO word_master (word, hanja, char1, hun1, char2, hun2, meaning, grade) VALUES`);
    const valueLines = batch.map(wm =>
      `  ('${esc(wm.word)}', '${esc(wm.hanja)}', '${esc(wm.char1)}', '${esc(wm.hun1)}', '${esc(wm.char2)}', '${esc(wm.hun2)}', '${esc(wm.meaning)}', ${wm.grade || 'NULL'})`
    );
    out.push(valueLines.join(',\n'));
    out.push(`ON CONFLICT (word) DO UPDATE SET`);
    out.push(`  hanja = EXCLUDED.hanja, char1 = EXCLUDED.char1, char2 = EXCLUDED.char2,`);
    out.push(`  hun1 = EXCLUDED.hun1, hun2 = EXCLUDED.hun2,`);
    out.push(`  meaning = EXCLUDED.meaning, grade = EXCLUDED.grade,`);
    out.push(`  updated_at = NOW();\n`);
  }

  // 2. sessions upsert + session_words 청소 + 재삽입
  for (const [key, words] of sessionWordsByKey) {
    const meta = sessionMeta.get(key);
    if (!meta) {
      console.error(`⚠️ 메타 없음: ${key}`);
      continue;
    }
    const slug = AREA_SLUG_MAP[meta.area];
    if (!slug) {
      console.error(`⚠️ 영역 매핑 없음: ${meta.area}`);
      continue;
    }

    out.push(`-- ── ${meta.area} ${meta.round}회차 (${meta.main_char} · ${meta.main_char_hangul}) ──`);

    // session upsert
    const meaningsJson = jsonEsc(meta.main_meanings);
    out.push(`INSERT INTO sessions (area_id, round_no, main_char, main_char_hangul, main_hun_short, main_eum, main_etymology, main_meanings, total_words)`);
    out.push(`VALUES (`);
    out.push(`  (SELECT id FROM areas WHERE slug='${slug}'),`);
    out.push(`  ${meta.round}, '${esc(meta.main_char)}', '${esc(meta.main_char_hangul)}', '${esc(meta.main_hun_short)}',`);
    out.push(`  '${esc(meta.main_meanings.map(m => m.hun).join(' · '))}',`);
    out.push(`  '${esc(meta.main_etymology)}',`);
    out.push(`  '${meaningsJson}'::jsonb,`);
    out.push(`  ${words.length}`);
    out.push(`) ON CONFLICT (area_id, round_no) DO UPDATE SET`);
    out.push(`  main_char = EXCLUDED.main_char, main_char_hangul = EXCLUDED.main_char_hangul,`);
    out.push(`  main_hun_short = EXCLUDED.main_hun_short, main_eum = EXCLUDED.main_eum,`);
    out.push(`  main_etymology = EXCLUDED.main_etymology, main_meanings = EXCLUDED.main_meanings,`);
    out.push(`  total_words = EXCLUDED.total_words, updated_at = NOW();\n`);

    // session_words 청소
    out.push(`DELETE FROM session_words WHERE session_id = (SELECT id FROM sessions WHERE area_id = (SELECT id FROM areas WHERE slug='${slug}') AND round_no = ${meta.round});\n`);

    // session_words 삽입
    words.forEach((sw, idx) => {
      const choices = [
        { text: sw.correctMeaning, is_correct: true },
        { text: sw.wrong1, is_correct: false },
        { text: sw.wrong2, is_correct: false },
        { text: sw.wrong3, is_correct: false },
      ];
      const choicesJson = jsonEsc(choices);
      out.push(`INSERT INTO session_words (session_id, word_master_id, fill_sentence, choices, is_infer_quiz, order_in_session)`);
      out.push(`SELECT s.id, wm.id, '${esc(sw.fillSentence)}', '${choicesJson}'::jsonb, false, ${idx + 1}`);
      out.push(`FROM sessions s, word_master wm`);
      out.push(`WHERE s.area_id = (SELECT id FROM areas WHERE slug='${slug}') AND s.round_no = ${meta.round}`);
      out.push(`  AND wm.word = '${esc(sw.word)}';`);
    });
    out.push('');
  }

  // 3. 검증 쿼리
  out.push('-- ── 검증 ──');
  out.push(`SELECT a.slug, s.round_no, s.main_char, s.total_words, COUNT(sw.id) AS actual_words`);
  out.push(`FROM sessions s JOIN areas a ON a.id = s.area_id LEFT JOIN session_words sw ON sw.session_id = s.id`);
  out.push(`GROUP BY a.slug, s.round_no, s.main_char, s.total_words ORDER BY a.slug, s.round_no;`);

  return out.join('\n');
}

// ─ 메인 실행 ─────────────────────────────────────
(async function() {
  console.error('Reading:', EXCEL_PATH);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);

  const wordMaster = parseWordMaster(wb.getWorksheet('뜻퀴즈_사전'));
  console.error('  word_master:', wordMaster.size, '개');

  const sessionMeta = parseSessionMeta(wb.getWorksheet('회차별 主字'));
  console.error('  session_meta:', sessionMeta.size, '개');

  const sessionWordsByKey = new Map();
  for (const [areaKr] of Object.entries(AREA_SLUG_MAP)) {
    if (TEST_AREA && areaKr !== TEST_AREA) continue;
    const ws = wb.getWorksheet(areaKr);
    if (!ws) continue;
    const rows = parseAreaSheet(ws, areaKr);
    rows.forEach(r => {
      if (TEST_MAX_ROUND && r.round > TEST_MAX_ROUND) return;
      const key = `${areaKr}-${r.round}`;
      if (!sessionWordsByKey.has(key)) sessionWordsByKey.set(key, []);
      sessionWordsByKey.get(key).push(r);
    });
  }
  console.error('  대상 회차:', sessionWordsByKey.size, '개');
  for (const [key, ws] of sessionWordsByKey) console.error('    ' + key + ':', ws.length, '어휘');

  const sql = generateSQL(wordMaster, sessionMeta, sessionWordsByKey);
  console.log(sql);
  console.error('\n✓ SQL 생성 완료 (stdout으로 출력)');
})().catch(err => { console.error('실패:', err); process.exit(1); });
