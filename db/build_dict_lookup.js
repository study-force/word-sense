// build_dict_lookup.js — 표준국어대사전 .xls → 분류 시스템용 룩업 테이블 추출
//
// 입력: 콘텐츠/표준국어대사전_20260504/*.xls (15개)
// 출력: db/dict_lookup_stdict.csv (통합 결과)
//
// 필터 (기획서 5.4.6절 기준):
//   ✅ 글자 수 = 2 (한글 음절 2개)
//   ✅ 구성 단위 = "단어"
//   ✅ 품사 = 「명사」
//   ✅ 어종 = 한자어 / 고유어 / 외래어 / 혼종어 모두 보존
//   ❌ 방언·옛말·고어·북한어 → 제외 (범주 컬럼 검사)
//   ❌ 인명·지명 등 고유명사 → 제외 (전문 분야 검사)
//
// 사용:
//   node db/build_dict_lookup.js [--sample]   # --sample: 첫 파일만 처리 (검증용)

const fs   = require('fs');
const path = require('path');
const XLSX = require('C:/Users/이재훈/Desktop/CLAUDE/node_modules/xlsx');

const DICT_DIR    = 'C:/Users/이재훈/Desktop/CLAUDE/word-sense/콘텐츠/표준국어대사전_20260504';
const OUTPUT_CSV  = 'C:/Users/이재훈/Desktop/CLAUDE/word-sense/db/dict_lookup_stdict.csv';
const SAMPLE_MODE = process.argv.includes('--sample');

// 어종 코드 (기획서 5.4.6)
const TYPE_MAP = {
  '한자어': 1, '고유어': 2, '외래어': 3, '혼종어': 4
};

// 한글 음절 정확히 2개 검사
const TWO_HANGUL = /^[가-힣]{2}$/;

// 명사 검사 — 「명사」 라벨이 들어있는지 (다른 품사 동거 가능, 명사 의미라도 있으면 OK)
function isNoun(pumsa) {
  return typeof pumsa === 'string' && pumsa.includes('「명사」');
}

// 방언/옛말 등 제외 대상 — 범주 컬럼에 다음 단어가 있으면 제외
const EXCLUDE_CATEGORIES = ['방언', '옛말', '고어', '북한어', '비표준어'];

// 인명·지명 등 고유명사 — 전문 분야에 다음이 있으면 제외
const EXCLUDE_DOMAINS = ['인명', '지명', '책명', '작품명'];

function shouldExclude(category, domain) {
  const cat = String(category || '');
  const dom = String(domain  || '');
  if (EXCLUDE_CATEGORIES.some(k => cat.includes(k))) return true;
  if (EXCLUDE_DOMAINS.some(k => dom.includes(k)))    return true;
  return false;
}

// 한자만 추출 (혼종어의 한자 부분 분리용 — 단순화: 모든 한자만 뽑음)
const HANJA_RE = /[一-鿿㐀-䶿]/g;
function extractHanja(wonEo) {
  if (!wonEo) return '';
  const matched = String(wonEo).match(HANJA_RE);
  return matched ? matched.join('') : '';
}

// 혼종어 조합 분석
//   '원어·어종' 컬럼에서 좌·우 어종 순서 추출.
//   예: "고유어 댕 한자 口"  → ['native', 'hanja'] → 'NH'
//       "한자 洞 고유어 네"   → ['hanja', 'native'] → 'HN'
//       "영어 roll 한자 紙"   → ['foreign', 'hanja'] → 'FH'
//   결과 코드 (2글자):
//     N=고유어(우리말) / H=한자 / F=외래어(영어 포함 모든 외국어)
function analyzeComposition(composition) {
  if (!composition) return '';
  const text = String(composition).replace(/\s+/g, ' ').trim();
  // 어종 라벨 매칭 — 한자 / 고유어 / 영어·외국어(외래어 통합)
  // 사전 표기상 영어는 영어로, 그 외 외국어는 그 언어명. 하지만 모두 외래어로 통합 (F).
  const TYPE_RE = /(한자|고유어|영어|외래어|불어|독일어|일본어|중국어|러시아어|이탈리아어|스페인어|포르투갈어|네덜란드어|라틴어|그리스어|아랍어|히브리어|페르시아어|산스크리트|몽골어|티베트어|만주어|에스파냐어)/g;
  const types = [];
  let m;
  while ((m = TYPE_RE.exec(text)) !== null) {
    const label = m[1];
    if (label === '한자') types.push('H');
    else if (label === '고유어') types.push('N');
    else types.push('F'); // 그 외 모든 외국어 = 외래어
  }
  if (types.length < 2) return '';
  // 첫 두 어종만 사용 (3개 이상은 첫 두 글자 음절 기준)
  return types[0] + types[1];
}

function processFile(filepath) {
  const wb = XLSX.readFile(filepath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  // raw=true로 모든 값 문자열로 (날짜 변환 등 방지)
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });

  const stats = {
    total: rows.length,
    pass: 0,
    drop_not_2han: 0,
    drop_not_word: 0,
    drop_not_noun: 0,
    drop_excluded: 0,
    by_type: { 한자어: 0, 고유어: 0, 외래어: 0, 혼종어: 0, 기타: 0 },
  };
  const out = [];

  for (const r of rows) {
    const wordRaw  = String(r['어휘']        || '').trim();
    const unit     = String(r['구성 단위']    || '').trim();
    const wordType = String(r['고유어 여부']  || '').trim();
    const wonEo    = String(r['원어']         || '').trim();
    const composition = String(r['원어·어종'] || '').trim();
    const pumsa    = String(r['품사']         || '').trim();
    const category = String(r['범주']         || '').trim();
    const domain   = String(r['전문 분야']    || '').trim();

    // 표제어 정규화 — 동음이의어 번호 표기 제거
    //   "공생(02)" → "공생", "기생01" → "기생", "공생-감" → 그대로 (필터에서 컷)
    const word = wordRaw.replace(/\(\d+\)$|\d+$/, '').trim();

    if (!TWO_HANGUL.test(word))   { stats.drop_not_2han++; continue; }
    if (unit !== '단어')          { stats.drop_not_word++; continue; }
    if (!isNoun(pumsa))           { stats.drop_not_noun++; continue; }
    if (shouldExclude(category, domain)) { stats.drop_excluded++; continue; }

    const typeCode = TYPE_MAP[wordType] || 0;
    if (typeCode === 0) { stats.by_type.기타++; continue; }
    stats.by_type[wordType]++;

    // 혼종어만 composition 코드 추출 (다른 어종은 빈 문자열)
    const compCode = (typeCode === 4) ? analyzeComposition(composition) : '';

    out.push({
      word,
      hanja: extractHanja(wonEo),
      word_type: typeCode,
      word_type_label: wordType,
      composition: compCode,
      source: 1, // 1 = 표준국어대사전
    });
    stats.pass++;
  }

  return { stats, out };
}

(function main() {
  const files = fs.readdirSync(DICT_DIR)
    .filter(f => f.toLowerCase().endsWith('.xls'))
    .sort();

  const targets = SAMPLE_MODE ? files.slice(0, 1) : files;
  console.error(`[run] ${targets.length}개 파일 처리 (전체 ${files.length}개)`);
  console.error(`[mode] ${SAMPLE_MODE ? 'sample (1 file)' : 'full'}`);

  const allRows = [];
  const totalStats = {
    total: 0, pass: 0,
    drop_not_2han: 0, drop_not_word: 0, drop_not_noun: 0, drop_excluded: 0,
    by_type: { 한자어: 0, 고유어: 0, 외래어: 0, 혼종어: 0, 기타: 0 },
  };

  for (const f of targets) {
    const fp = path.join(DICT_DIR, f);
    console.error(`[file] ${f}`);
    const { stats, out } = processFile(fp);
    console.error(`        total=${stats.total} pass=${stats.pass} ` +
      `(2자X=${stats.drop_not_2han} 단어X=${stats.drop_not_word} ` +
      `명사X=${stats.drop_not_noun} 제외=${stats.drop_excluded})`);
    console.error(`        어종: 한자어=${stats.by_type.한자어} 고유어=${stats.by_type.고유어} ` +
      `외래어=${stats.by_type.외래어} 혼종어=${stats.by_type.혼종어} 기타=${stats.by_type.기타}`);
    // 누적
    totalStats.total          += stats.total;
    totalStats.pass           += stats.pass;
    totalStats.drop_not_2han  += stats.drop_not_2han;
    totalStats.drop_not_word  += stats.drop_not_word;
    totalStats.drop_not_noun  += stats.drop_not_noun;
    totalStats.drop_excluded  += stats.drop_excluded;
    for (const k of Object.keys(totalStats.by_type)) {
      totalStats.by_type[k] += stats.by_type[k];
    }
    allRows.push(...out);
  }

  // 전체 행 dedupe — (word, hanja, source) 기준 (DB UNIQUE 제약과 일치)
  //   같은 한자 표기에 여러 의미가 분리 등재된 경우 (예: 대수 代數 — 수학 / 대 잇기) 첫 번째만 유지
  //   고유어 동음이의어(가난01·가난02 등 한자 빈 문자열)도 마찬가지
  const dedupeMap = new Map();
  for (const r of allRows) {
    const key = `${r.word}|${r.hanja}|${r.source}`;
    if (!dedupeMap.has(key)) dedupeMap.set(key, r);
  }
  const beforeDedup = allRows.length;
  allRows.length = 0;
  allRows.push(...dedupeMap.values());
  console.error(`\n[dedupe] ${beforeDedup} → ${allRows.length} (${beforeDedup - allRows.length}개 중복 제거)`);

  // CSV 출력 — Supabase Import 호환 (테이블 컬럼과 1:1 일치)
  const header = 'word,hanja,word_type,composition,source';
  const lines = [header];
  for (const r of allRows) {
    // 콤마·따옴표 안전 처리
    const esc = (v) => {
      const s = String(v || '');
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    lines.push([
      esc(r.word), esc(r.hanja), r.word_type,
      esc(r.composition), r.source
    ].join(','));
  }
  fs.writeFileSync(OUTPUT_CSV, lines.join('\n') + '\n', 'utf8');
  console.error(`\n[output] ${OUTPUT_CSV}  (${allRows.length} rows)`);

  // 샘플 출력 (앞 10개)
  console.error('\n[sample first 10 rows]');
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const r = allRows[i];
    console.error(`  ${i+1}. ${r.word} | ${r.hanja || '-'} | ${r.word_type_label}`);
  }

  // 종합 통계
  console.error('\n[total stats]');
  console.error(`  total rows scanned : ${totalStats.total}`);
  console.error(`  passed             : ${totalStats.pass}`);
  console.error(`  dropped (2자 아님)  : ${totalStats.drop_not_2han}`);
  console.error(`  dropped (단어 아님) : ${totalStats.drop_not_word}`);
  console.error(`  dropped (명사 아님) : ${totalStats.drop_not_noun}`);
  console.error(`  dropped (제외 대상) : ${totalStats.drop_excluded}`);
  console.error(`  어종 분포:`);
  console.error(`    한자어: ${totalStats.by_type.한자어}`);
  console.error(`    고유어: ${totalStats.by_type.고유어}`);
  console.error(`    외래어: ${totalStats.by_type.외래어}`);
  console.error(`    혼종어: ${totalStats.by_type.혼종어}`);
  console.error(`    기타  : ${totalStats.by_type.기타} (어종 미분류 → 제외됨)`);

  // 혼종어 조합 분포
  const hybridComp = {};
  let hybridUnknown = 0;
  for (const r of allRows) {
    if (r.word_type !== 4) continue;
    const c = r.composition || '';
    if (!c) { hybridUnknown++; continue; }
    hybridComp[c] = (hybridComp[c] || 0) + 1;
  }
  console.error(`\n[혼종어 조합 분포]`);
  const compLabel = {
    NH: '우리말+한자', HN: '한자+우리말',
    FH: '외래어+한자', HF: '한자+외래어',
    NF: '우리말+외래어', FN: '외래어+우리말',
    HH: '한자+한자(병기)', NN: '우리말+우리말', FF: '외래어+외래어'
  };
  Object.entries(hybridComp).sort((a,b) => b[1]-a[1]).forEach(([code, n]) => {
    console.error(`    ${code} (${compLabel[code] || '기타'}): ${n}`);
  });
  if (hybridUnknown > 0) console.error(`    파싱실패: ${hybridUnknown}`);
})();
