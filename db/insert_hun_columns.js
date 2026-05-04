// insert_hun_columns.js — 기존 Excel의 서식 보존하며 B열 오른쪽에 2개 열 삽입
//
// 입력: 박차장님 검수본 Excel
// 출력: J/K 가 아닌 C/D 위치에 훈음 컬럼 삽입된 새 파일
//
// 결과 구조 (뜻퀴즈_사전 시트):
//   A: 어휘    B: 한자    C: 첫 글자 훈음 (NEW)    D: 둘째 글자 훈음 (NEW)
//   E~: 기존 C~ 컬럼들이 그대로 오른쪽으로 밀림 (서식·색상 모두 보존)

const fs = require('fs');
const ExcelJS = require('C:/Users/이재훈/AppData/Local/Temp/xlsx_mod/node_modules/exceljs');

const INPUT_CANDIDATES = [
  'C:/Users/이재훈/Downloads/훈감각_사전콘텐츠_박차장님용 (1).xlsx',
  'C:/Users/이재훈/Desktop/CLAUDE/word-sense/콘텐츠/훈감각_사전,콘텐츠.xlsx',
];
const inputPath = INPUT_CANDIDATES.find(p => fs.existsSync(p));
if (!inputPath) { console.error('입력 Excel 못 찾음.'); process.exit(1); }

const outputPath = 'C:/Users/이재훈/Desktop/CLAUDE/word-sense/콘텐츠/훈감각_사전콘텐츠_박차장님용_훈음추가.xlsx';
const hunDict = JSON.parse(fs.readFileSync('C:/Users/이재훈/Desktop/CLAUDE/word-sense/db/hun_dict.json', 'utf8'));

console.error('입력:', inputPath);
console.error('출력:', outputPath);

(async function() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);

  const ws = workbook.getWorksheet('뜻퀴즈_사전');
  if (!ws) { console.error('뜻퀴즈_사전 시트 없음'); process.exit(1); }

  console.error('원본 행 수:', ws.rowCount, '/ 컬럼 수:', ws.columnCount);

  // 헤더 행은 row 3 (rows 1-2는 안내문)
  // 데이터는 row 4 부터
  // ── 단계 1: B열 오른쪽에 2개 빈 컬럼 삽입 (서식 보존)
  // ExcelJS의 spliceColumns(start, count, ...) — start는 1-based, 위치 3에 2컬럼 insert(0개 삭제)
  // 첫 번째 인자: 삽입 위치 (3 = C 컬럼 위치)
  // 두 번째 인자: 삭제 개수 (0)
  // 그 다음 인자들: 새 컬럼 데이터 (각 컬럼은 행별 값 배열)

  // 행별 hun 매핑 미리 계산
  const rowCount = ws.rowCount;
  const newColC = new Array(rowCount).fill(null);  // 첫 글자 훈음
  const newColD = new Array(rowCount).fill(null);  // 둘째 글자 훈음

  // 헤더 (row 3, 0-based index 2)
  newColC[2] = '첫 글자 훈음';
  newColD[2] = '둘째 글자 훈음';

  // 데이터 행 (row 4 ~)
  let filled = 0, missing = 0;
  const missingChars = new Set();
  for (let r = 4; r <= rowCount; r++) {
    const hanjaCell = ws.getCell(r, 2);   // B 컬럼
    const hanjaRaw = hanjaCell && hanjaCell.value ? String(hanjaCell.value) : '';
    if (!hanjaRaw) continue;
    const hanjaOnly = hanjaRaw.match(/[一-鿿]/g) || [];
    const c1 = hanjaOnly[0];
    const c2 = hanjaOnly[1];

    let hun1 = c1 ? hunDict[c1] : null;
    let hun2 = c2 ? hunDict[c2] : null;
    if (c1 && !hun1) { missingChars.add(c1); hun1 = '[검토] ' + c1; missing++; }
    if (c2 && !hun2) { missingChars.add(c2); hun2 = '[검토] ' + c2; missing++; }

    newColC[r - 1] = hun1;   // 0-based array, row r → index r-1
    newColD[r - 1] = hun2;
    if (hun1) filled++;
    if (hun2) filled++;
  }

  // 컬럼 삽입
  ws.spliceColumns(3, 0, newColC, newColD);

  // 새 컬럼 너비 설정 (적절한 가독성)
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 14;

  // 헤더 셀 스타일을 인근 헤더(예: A3)와 동일하게 맞춤 (ExcelJS는 인접 컬럼 스타일을 자동 상속하지 않음)
  const headerRefCell = ws.getCell('A3');
  ['C3', 'D3'].forEach(addr => {
    const cell = ws.getCell(addr);
    if (headerRefCell.style) {
      // 깊은 복사로 스타일 적용
      cell.style = JSON.parse(JSON.stringify(headerRefCell.style));
    }
  });

  console.error('채운 셀:', filled, '/ [검토] 마크:', missing);
  if (missingChars.size > 0) console.error('미매핑 한자:', [...missingChars].join(' '));

  // 저장
  await workbook.xlsx.writeFile(outputPath);
  console.error('\n✓ 저장 완료:', outputPath);
})().catch(err => {
  console.error('실패:', err);
  process.exit(1);
});
