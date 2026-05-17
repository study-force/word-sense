# 외부 연동 배포 가이드

## 아키텍처

```
[학원 테넌트 마이룸 (*.sfcenter.co.kr)]
   ↓ 학생 "한자 훈련" 클릭
   ↓ POST application/json (학생/회차/payment_fn ...)
[Supabase Edge Function: wordsense-start]
   ↓ session_init INSERT (UUID, TTL 10분)
   ↓ 응답: { redirectUrl: "https://word.sfcenter.co.kr/?st={uuid}" }
[구서버가 학생 브라우저를 redirectUrl로 이동]
[학생 브라우저 — word.sfcenter.co.kr (Vercel 배포)]
   ↓ URL ?st=... 파싱
   ↓ fetch wordsense-session → 학생/회차 데이터 받음
   ↓ window.STUDENT_INFO/TRAINING_INFO 메모리 보관
   ↓ 학습 진행 (인출 → 확장 → 강화)
   ↓ 강화 완료 → goResult 진입
   ↓ fetch wordsense-complete
[Supabase Edge Function: wordsense-complete]
   ↓ service-back JWT 토큰 (캐시 또는 발급)
   ↓ POST /api/public/hanja/study/complete
[구서버 sf_study_hanja 업데이트]
```

## 배포 순서

### 1. DB 마이그레이션
1. Supabase Studio → SQL Editor
2. `db/migrations/2026-05-17_external_integration.sql` 복붙 → RUN
3. 4개 테이블 생성 확인: `students`, `academies`, `session_init`, `service_back_token`

### 2. Supabase Secrets 등록
Supabase Dashboard → Project Settings → Edge Functions → Secrets:
- `EXTERNAL_JWT_SECRET` = (운영팀에서 받은 키)
- `SERVICE_BACK_BASE_URL` = `https://www.futuretraining.co.kr:8143/service-back` (상용)
  또는 `https://www.futuretraining.co.kr:8193/service-back` (개발)
- `STUDENT_REDIRECT_BASE` = `https://word.sfcenter.co.kr/word-sense.html`
- (선택) `ALLOWED_ORIGINS` = `https://sfcenter.co.kr,https://sfos.kr` (와일드카드 외 추가 origin)

### 3. Edge Function 배포
로컬에서 Supabase CLI:
```bash
cd word-sense
supabase login
supabase link --project-ref {project-ref}
supabase functions deploy wordsense-start
supabase functions deploy wordsense-session
supabase functions deploy wordsense-complete
```

배포 후 URL:
- `https://{project}.functions.supabase.co/wordsense-start`
- `https://{project}.functions.supabase.co/wordsense-session`
- `https://{project}.functions.supabase.co/wordsense-complete`

### 4. Vercel 배포
1. Vercel 대시보드 → New Project → GitHub `study-force/word-sense` 연결
2. Framework Preset: **Other** (정적 사이트)
3. Build Command: 비움
4. Output Directory: `.` (루트)
5. Deploy

배포 후:
- 임시 URL: `https://word-sense-{hash}.vercel.app/word-sense.html` 로 확인
- Custom Domain → `word.sfcenter.co.kr` 추가
- DNS 설정 (도메인 관리자 측):
  ```
  CNAME word → cname.vercel-dns.com
  ```
- SSL 자동 발급 대기 (수 분)

### 5. 운영팀에 알려줘야 할 정보
구서버 측에 등록할 정보:
- **진입 POST URL**: `https://{project}.functions.supabase.co/wordsense-start`
- **요청 형식**: doc1 그대로 (application/json, 9개 필드)
- **응답**: 200 OK + `{ success, redirectUrl, sessionId }`
- **학생 redirect 처리**: 학원 backend가 응답의 `redirectUrl`로 학생 브라우저 이동

### 6. 통합 테스트
1. 구서버에서 테스트 학생 데이터로 POST 호출
2. 응답의 `redirectUrl`로 진입 → word-sense 로드 확인
3. URL `?st=...` 자동 파싱 + 학생 이름 표시 확인 (console.log `[student] 진입 학생: ...`)
4. 학습 끝까지 진행 (인출→확장→강화)
5. goResult 진입 시 wordsense-complete 호출 → service-back complete API 응답 200 확인
6. 구서버 `sf_study_hanja`에 행 생성/업데이트 확인

## 문제 해결

### 학생 정보 안 뜸
- 브라우저 console에 `[student] session 조회 실패: 404`
  → session_init 만료(10분) 또는 sessionId 잘못. 구서버에 다시 진입 요청.
- `[student] session fetch 오류` → CORS 또는 네트워크. Edge Function 도메인 학원 origin 화이트리스트 확인.

### 학습 완료 후 sf_study_hanja 업데이트 안 됨
- console에 `[complete] service-back 알림 실패`
  → service-back 응답 코드 확인.
  - 400 결제 정보 없음 → payment_fn 잘못 전달
  - 401 인증 실패 → EXTERNAL_JWT_SECRET 잘못
- service_back_token 테이블에 토큰 캐시 확인 (만료 없는 영구 토큰)
- 토큰 회수 의심 시 `DELETE FROM service_back_token;` → 다음 호출 시 재발급

### TQ와 같은 도메인이지만 다른 서브
- TQ: `tq.sfcenter.co.kr`
- word-sense: `word.sfcenter.co.kr`
- 두 시스템 독립. DNS·Vercel 프로젝트 별개.
