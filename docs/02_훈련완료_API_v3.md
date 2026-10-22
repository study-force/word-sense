# 한자 훈감각익히기 — 훈련 완료 API (v3)

> 출처: 개발팀 제공 `hanja_study_api_doc_v3.docx` (service-back | Legacy DB API)
> 원본: `docs/source/hanja_study_api_doc_v3.docx`
> 문서 버전 **v3** · 작성일 2026-05-11 · 확인: 2026-10-12

## 1. 개요

외부 훈련프로그램(훈감각익히기)에서 **훈련 완료 콜백**을 수신하여,
구 DB(`trainingcenter`)의 **`sf_study_hanja`** 테이블에 훈련 이력을 기록한다.

- 🔐 인증된 외부 서버만 호출 — **JWT Bearer 토큰 필수**
- 토큰 발급: `POST /api/public/external/token` (`X-External-Secret` 헤더)
- 발급 토큰은 **향후 다른 훈련 API에도 공통 사용**
- Legacy DB 조회/저장: `sf_payment`, `sf_study_hanja`
- 기존 row 없을 시 400, 동일 회차 중복 요청 시 400

## 2. 인증

### 2-1. 토큰 발급 — `POST /api/public/external/token`

요청 헤더: `X-External-Secret: {사전 공유 Secret Key}` (필수)

```
POST .../api/public/external/token
X-External-Secret: your-secret-key-here

--- 응답 (200 OK) ---
{ "token": "eyJhbGciOiJIUzI1NiJ9...", "tokenType": "Bearer", "timestamp": "..." }
```

### 2-2. 토큰 사용

모든 요청의 `Authorization: Bearer {token}` 헤더에 포함.
토큰 없음/무효 → **401**. **토큰은 만료 없음** → 최초 1회 발급 후 영구 보관.

## 3. 기본 정보

| 항목 | 값 |
|---|---|
| Base URL (상용) | `https://www.futuretraining.co.kr:8143/service-back` |
| Base URL (개발) | `https://www.futuretraining.co.kr:8193/service-back` |
| 메서드 | `POST` |
| 엔드포인트 | `/api/public/hanja/study/complete` |
| 인증 | 필수 — `Authorization: Bearer {token}` |
| Content-Type | `application/json` |

## 4. 훈련 완료 처리 — `POST /api/public/hanja/study/complete`

요청 Body (application/json):

| 파라미터 | 타입 | 필수 | 설명 | 예시 |
|---|---|---|---|---|
| `payment_fn` | String | Y | 암호화된 결제 번호 (MD5 해시) | `62cbf3457ddb6cf2a460692215136dac` |
| `training_round` | Number | Y | 완료한 훈련 회차 (1 이상 정수) | `17` |

### 응답 상태코드

| 코드 | 케이스 | 설명 |
|---|---|---|
| 200 | 성공 | `success: true` |
| 400 | 중복 요청 | `study_end_date` 값 존재 → "이미 처리된 훈련 회차입니다." |
| 400 | 결제 정보 없음 | `payment_fn`으로 `sf_payment` row 못 찾음 |
| 400 | 훈련 정보 없음 | `sf_study_hanja`에 해당 회차 row 없음 → "훈련 정보가 없습니다." |
| 400 | 입력값 오류 | 필수 파라미터 누락/형식 오류 |
| 401 | 인증 실패 | Authorization 헤더 없음/토큰 무효 |
| 500 | 서버 오류 | DB 오류 등 |

```
✅ 200 { "success": true, "message": "훈련 정보가 저장되었습니다.", "timestamp": "..." }
❌ 400 { "status": 400, "message": "이미 처리된 훈련 회차입니다.", "timestamp": "..." }
❌ 400 { "status": 400, "message": "훈련 정보가 없습니다.", "timestamp": "..." }
❌ 401 { "status": 401, "message": "토큰이 없습니다.", "timestamp": "..." }
```

## 5. 서버 내부 처리 로직

| 단계 | 처리 | 실패 시 |
|---|---|---|
| 인증 | `ExternalJwtFilter`가 토큰 검증 | 401 |
| 1단계 | `sf_payment`에서 `MD5(payment_no) = payment_fn` 조회 | 400 결제 정보 없음 |
| 2단계 | `sf_study_hanja`에서 해당 회차 기존 row 조회 | — |
| 2-1 | 기존 row 없음 → 훈련 정보 없음 | 400 |
| 2-2 | row 있음 + `study_end_date IS NULL` → UPDATE (`study_end_date = NOW()`) | 500 |
| 2-3 | row 있음 + `study_end_date` 값 있음 → 중복 요청 | 400 |
| 3단계 | `training_round >= 2`이면, 이전 회차(`study_group_no < training_round`) 중 `study_end_date IS NULL`인 row의 `study_end_date`를 **다음 회차(`study_group_no+1`)의 `study_start_date − 1분`**으로 보정 | 500 |

예) 3회차 완료 요청, 1회차 `study_end_date`가 null → 1회차 `study_end_date` = 2회차 `study_start_date − 1분`.

## 6. 클라이언트 연동 예시 (fetch)

```javascript
const BASE_URL = 'https://www.futuretraining.co.kr:8143/service-back';
const SECRET   = 'your-secret-key-here';

async function getToken() {                       // Step 1: 최초 1회
  const res = await fetch(`${BASE_URL}/api/public/external/token`, {
    method: 'POST', headers: { 'X-External-Secret': SECRET },
  });
  return (await res.json()).token;
}

async function completeTraining(token, paymentFn, trainingRound) {   // Step 2
  const res = await fetch(`${BASE_URL}/api/public/hanja/study/complete`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payment_fn: paymentFn, training_round: trainingRound }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message);
  return data;
}
```

## 7. 참고

- **Secret Key(`X-External-Secret`)는 운영팀에서 별도 공유** (문서엔 미포함).
- JWT는 만료 없음 → 최초 1회 발급 후 안전 보관·재사용.
- 이 토큰은 한자 API 외 향후 다른 훈련 API에도 동일 사용.
- 5xx 발생 시 기술팀 문의.

## 변경 이력

| 버전 | 날짜 | 변경 |
|---|---|---|
| V0 | 2026-05-08 | 최초 작성 |
| V1 | 2026-05-08 | JWT 인증 추가 |
| V2 | 2026-05-08 | 중복 요청 처리 (`study_end_date` 있을 시 400) |
| V3 | 2026-05-11 | 2단계 insert 로직 제거 / 3단계 보정 기준 변경(다음 회차 `study_start_date − 1분`) / 2단계 기존 row 없을 시 400 추가 |
