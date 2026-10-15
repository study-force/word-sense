# word-sense (훈감각익히기) — 개발팀 연동 문서

개발팀(study-force / service-back)에서 받은 **외부 연동 공식 문서** 정리본.
확인/정리: 2026-10-12.

## 문서

| 파일 | 내용 |
|---|---|
| [01_진입데이터_POST.md](01_진입데이터_POST.md) | 앱 **진입 시** 외부 시스템이 보내는 POST 데이터 (student·academy·payment_fn·training_round) |
| [02_훈련완료_API_v3.md](02_훈련완료_API_v3.md) | 훈련 **완료 시** 레거시 DB로 보내는 콜백 API (JWT, `/hanja/study/complete`) |
| `source/` | 개발팀 원본 .docx 2개 |

## 전체 흐름 (문서 기준)

```
[학원관리 시스템]
   │  (1) 진입: POST → study-force.github.io/word-sense/word-sense.html
   │        { name, user_no, user_section, user_school_grade,
   │          academy_name, academy_no, is_payment, payment_fn, training_round }
   ▼
[훈감각익히기 앱 (GitHub Pages)]
   │  (2) 완료: POST → futuretraining.co.kr:8143/service-back
   │        /api/public/hanja/study/complete   (Authorization: Bearer JWT)
   │        { payment_fn, training_round }
   ▼
[Legacy DB: trainingcenter.sf_study_hanja]  (회차 완료 이력 기록)
```

## ✅ 최신 연동 상태 (2026-10-15, 개발팀 성효민 대리 테스트 완료)

- **최신 연동 문서: `source/훈감각익히기_연동방법_20261015.docx`** (아래 옛 메모보다 우선)
- 진입: 학원 → Edge `wordsense-start`(POST) → `redirectUrl`(`?st={uuid}`) → 앱. 완료: 앱 결과 화면에서 `wordsense-complete` → service-back `/api/public/hanja/study/complete` (body: payment_fn, training_round, study_token)
- **`training_level`(훈련 과정) 추가**: `elementary` / `middle` (한글 초등/중등도 인식, 없으면 초등). 학제 `user_section`과 별개
- `training_round` = 영역별 회차(1~50), `training_area` = biology/society/history/science/culture/economy
- 개발계(word.sfos.kr → 테스트 DB xzxgsqpvtckxgvipchsy)에서 진입·완료·학원 기록(200)·끝내기 창 닫힘·완료 입장권 폐기·중등 과정 진입 모두 확인
- 입장권: 첫 열기 10분 안, 이후 3시간 새로고침 허용, 완료되면 폐기

## ⚠️ 기존 메모와 다른 점 / 확인 필요

> 아래는 2026-10-12 무렵 메모 — 일부는 위 최신 상태로 해소됨(테섭 DB 구축 완료, 과정은 training_level로 구분).

- **식별 키**: 이 문서는 `user_no` + `payment_fn`(+`training_round`) 사용. 기존 메모의 `member_no`와 관계 확인 필요.
- **완료 기록 위치**: 레거시 DB(`sf_study_hanja`, futuretraining.co.kr). 기존 메모의 **Supabase**(attempts/word_results/area_progress/wrong_words)와는 별개로 보임
  → 추정: 레거시=회차 완료 상태(학원관리/정산용), Supabase=앱 자체 상세(어휘별) 기록. **관계 확정 필요.**
- **도메인 구조 (대표님 확정 2026-10-12)**: **`word.sfcenter.co.kr` = 실섭(운영)** · **`word.sfos.kr` = 테섭(테스트)** — 둘 다 Vercel, 의도된 구조(잔재 아님). **테스트 서버(별도 DB) 아직 미구축** → 지금은 테섭도 운영 DB(word-master) 공유(data-supabase.js 분기 꺼둠). 테섭 구축 시 `word.sfos.kr` → 테스트 DB로 분기 예정.
- **단, GitHub Pages(`study-force.github.io/word-sense/`)도 live & 운영 DB**이고 **개발팀 연동문서·word-sense/HANDOFF.md가 진입 URL로 이걸 명시** → **실제 학생 진입이 실섭(word.sfcenter)인지 GitHub Pages인지 개발팀과 정렬 필요**(진입 방식 POST vs `?st`도 함께 확인).
- **학제(user_section) 6종 ≠ 훈련 과정 2종(초등/중등)** — 서로 매칭되는 데이터 아님(대표님 확인 2026-10-12). 학제=학생 신상, 과정=콘텐츠. 별개 로직. (매핑 규칙 불필요)
- **결과지(teacher-result) 데이터 소스**: 이 두 API는 완료를 *쓰기*만 함. 선생님 결과지의 상세 통계/도넛을 *읽어올* 소스는 이 문서에 없음(앱 Supabase 또는 별도 조회 API 필요).
- **Secret Key / X-External-Secret**: 운영팀 별도 공유 (문서 미포함).
