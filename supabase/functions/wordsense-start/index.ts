// ════════════════════════════════════════════════════════════════
// Edge Function: wordsense-start
//
// 역할: 구서버에서 학생 진입 POST를 받아 학습 페이지로 리다이렉트.
//
// 입력 (POST application/json — 연동방법_20261014 문서):
//   { user_name(또는 name), user_no, user_section, user_school_grade,
//     academy_name, academy_no, payment_fn, training_round, training_area, study_token,
//     training_level?(elementary/middle 또는 초등/중등, 없으면 초등),
//     training_mode?("retry" = 재훈련 — study_token 불필요, 학원 완료 API 미호출), is_payment? }
//
// 처리:
//   1) 입력 검증 (필수 필드)
//   2) academies / students upsert (캐시 갱신)
//   3) session_init INSERT → UUID 생성 (TTL 10분)
//   4) 응답 redirectUrl = {STUDENT_REDIRECT_BASE}?st={uuid}  (테섭 word.sfos.kr / 실섭 word.sfcenter.co.kr)
//
// 호출:
//   POST https://{project}.functions.supabase.co/wordsense-start
//   (구서버가 학생 클릭 시 호출 + 응답의 Location으로 학생 브라우저 redirect)
//
// secrets:
//   STUDENT_REDIRECT_BASE  — 'https://word.sfcenter.co.kr/word-sense.html'
//   ALLOWED_ORIGINS        — 'https://sfcenter.co.kr,https://sfos.kr' (콤마 구분)
// ════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const REDIRECT_BASE = Deno.env.get('STUDENT_REDIRECT_BASE') || 'https://word.sfcenter.co.kr/word-sense.html';
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  // 학원 서브도메인 모두 허용 — *.sfcenter.co.kr / *.sfos.kr
  const isAllowed = origin && (
    /\.sfcenter\.co\.kr$/.test(new URL(origin).hostname) ||
    /\.sfos\.kr$/.test(new URL(origin).hostname) ||
    ALLOWED_ORIGINS.includes(origin)
  );
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin! : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const cors = corsHeaders(origin);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // ── 입력 파싱 + 검증 ──
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonErr(400, '입력 JSON 파싱 실패', cors);
  }

  // 이름: 연동 문서는 user_name, 옛 명세는 name — 둘 다 받음
  const userName = String(body.user_name ?? body.name ?? '').trim();
  const userNo = Number(body.user_no);
  const round = Number(body.training_round);
  const area = String(body.training_area ?? '').trim();
  // 훈련 과정 — 영어 코드 elementary/middle 권장, 한글 초등/중등도 인식 (학제 user_section과는 별개). 없으면 초등
  const lv = String(body.training_level ?? '').trim().toLowerCase();
  const level = (lv === 'middle' || lv === '중등') ? '중등' : '초등';
  const studyToken = String(body.study_token ?? '').trim();
  // 훈련 방식 — retry(재훈련: 학원 완료 API 미호출, study_token 불필요) / 그 외 normal
  const mode = String(body.training_mode ?? '').trim().toLowerCase() === 'retry' ? 'retry' : 'normal';
  const AREAS = ['biology', 'society', 'history', 'science', 'culture', 'economy'];
  if (!userName) return jsonErr(400, '필수 필드 누락: user_name', cors);
  if (!Number.isFinite(userNo)) return jsonErr(400, '필수 필드 누락/형식 오류: user_no', cors);
  if (!body.payment_fn) return jsonErr(400, '필수 필드 누락: payment_fn', cors);
  if (!Number.isInteger(round) || round < 1) return jsonErr(400, '필수 필드 누락/형식 오류: training_round', cors);
  if (!AREAS.includes(area)) return jsonErr(400, 'training_area는 ' + AREAS.join('/') + ' 중 하나여야 합니다', cors);
  if (mode === 'normal' && !studyToken) return jsonErr(400, '필수 필드 누락: study_token', cors);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  try {
    // ── 학원 upsert ──
    if (body.academy_no) {
      await supabase.from('academies')
        .upsert({ academy_no: Number(body.academy_no), name: body.academy_name || '' },
                { onConflict: 'academy_no' });
    }

    // ── 학생 upsert ──
    await supabase.from('students')
      .upsert({
        user_no: userNo,
        name: userName,
        section: body.user_section || null,
        school_grade: body.user_school_grade != null ? Number(body.user_school_grade) : null,
        academy_no: body.academy_no != null ? Number(body.academy_no) : null,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'user_no' });

    // ── 진입 세션 INSERT (10분 TTL) ──
    const { data: session, error: sErr } = await supabase
      .from('session_init')
      .insert({
        user_no: userNo,
        payment_fn: String(body.payment_fn),
        training_round: round,
        training_area: area,
        training_level: level,
        study_token: studyToken || null,
        training_mode: mode,
        is_payment: body.is_payment || 'N',
        academy_no: body.academy_no != null ? Number(body.academy_no) : null,
      })
      .select('id')
      .single();

    if (sErr || !session) {
      console.error('[wordsense-start] session_init INSERT 실패:', sErr);
      return jsonErr(500, '세션 생성 실패', cors);
    }

    // ── 302 redirect URL 생성 ──
    const redirectUrl = `${REDIRECT_BASE}?st=${session.id}`;

    return new Response(JSON.stringify({
      success: true,
      redirectUrl,
      sessionId: session.id,
    }), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        // 학원이 직접 학생 브라우저를 보낼 경우 Location 헤더도 (302 응답)
        'Location': redirectUrl,
      },
    });
  } catch (err) {
    console.error('[wordsense-start] 처리 실패:', err);
    return jsonErr(500, '서버 오류: ' + (err as Error).message, cors);
  }
});

function jsonErr(status: number, message: string, cors: Record<string, string>) {
  return new Response(JSON.stringify({ success: false, status, message }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
