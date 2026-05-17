// ════════════════════════════════════════════════════════════════
// Edge Function: wordsense-start
//
// 역할: 구서버에서 학생 진입 POST를 받아 학습 페이지로 리다이렉트.
//
// 입력 (POST application/json — doc1 명세):
//   { name, user_no, user_section, user_school_grade,
//     academy_name, academy_no, is_payment, payment_fn, training_round }
//
// 처리:
//   1) 입력 검증 (필수 필드)
//   2) academies / students upsert (캐시 갱신)
//   3) session_init INSERT → UUID 생성 (TTL 10분)
//   4) 302 redirect → https://word.sfcenter.co.kr/word-sense.html?st={uuid}
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

  const required = ['name', 'user_no', 'payment_fn', 'training_round'];
  for (const f of required) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      return jsonErr(400, `필수 필드 누락: ${f}`, cors);
    }
  }
  if (typeof body.user_no !== 'number' || typeof body.training_round !== 'number') {
    return jsonErr(400, 'user_no/training_round는 숫자여야 합니다', cors);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  try {
    // ── 학원 upsert ──
    if (body.academy_no) {
      await supabase.from('academies')
        .upsert({ academy_no: body.academy_no, name: body.academy_name || '' },
                { onConflict: 'academy_no' });
    }

    // ── 학생 upsert ──
    await supabase.from('students')
      .upsert({
        user_no: body.user_no,
        name: body.name,
        section: body.user_section || null,
        school_grade: body.user_school_grade || null,
        academy_no: body.academy_no || null,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'user_no' });

    // ── 진입 세션 INSERT (10분 TTL) ──
    const { data: session, error: sErr } = await supabase
      .from('session_init')
      .insert({
        user_no: body.user_no,
        payment_fn: body.payment_fn,
        training_round: body.training_round,
        is_payment: body.is_payment || 'N',
        academy_no: body.academy_no || null,
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
