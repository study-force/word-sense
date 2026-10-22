# 훈감각익히기 — 진입 시 전달 데이터 (POST)

> 출처: 개발팀 제공 `훈감각익히기_연동 데이터_20260512.docx`
> 원본: `docs/source/훈감각익히기_연동데이터_20260512.docx` · 확인: 2026-10-12

훈감각 익히기 **첫 화면 진입 시**, 외부(학원관리) 시스템이 POST로 전달하는 값.

- **진입 URL**: `https://study-force.github.io/word-sense/word-sense.html`  ← GitHub Pages
- **Content-Type**: `application/json`

| 필드명 | 타입 | 설명 | 예시 |
|---|---|---|---|
| `name` | string | 학생 이름 | `"홍길동"` |
| `user_no` | number | 회원 번호 | `86453` |
| `user_section` | string | 학제 (초등 / 중등 / 고등 / 초등(고) / N수생 / 일반) | `"중등"` |
| `user_school_grade` | number | 학년 | `2` |
| `academy_name` | string | 학원명 | `"공부의철인(분당본원)"` |
| `academy_no` | number | 학원 번호 | `1904` |
| `is_payment` | string | 결제 여부 (Y / N) | `"Y"` |
| `payment_fn` | string | 암호화된 결제 번호 (MD5 해시) | `"62cbf3457ddb6cf2a460692215136dac"` |
| `training_round` | number | 진행할 훈련 회차 | `17` |

## 메모 (우리 쪽 확인 필요)

- 식별 키는 **`user_no`(회원번호)** + **`payment_fn`(암호화 결제번호)**, 진행 회차는 **`training_round`**.
  완료 콜백 API는 `payment_fn` + `training_round` 로 레코드를 찾는다 → [02_훈련완료_API_v3.md](02_훈련완료_API_v3.md) 참고.
- **학제(`user_section`) 6종**(초등/중등/고등/초등(고)/N수생/일반) **≠ 훈련 과정 2종(초등/중등)**. 둘은 **서로 매칭되는 데이터가 아님**(대표님 확인 2026-10-12) — 학제=학생 신상, 과정=콘텐츠 구분. 별개 로직.
- 진입 URL이 **Vercel이 아니라 GitHub Pages** (`study-force.github.io/word-sense/`).
