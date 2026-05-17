// ════════════════════════════════════════════════════════════════
// Edge Function: wordsense-complete
//
// 역할: 학생 학습 완료 시 호출 — 두 가지 작업
//   1) (선택) 학습 결과 Supabase attempts/word_results INSERT (Phase 2와 통합 시)
//   2) service-back complete API 호출 (sf_study_hanja 업데이트)
//
// 입력 (POST application/json):
//   { sessionId, payment_fn, training_round,
//     score?, tier_level?, ... 학습 결과 메타 (선택) }
//
// secrets:
//   EXTERNAL_JWT_SECRET     — service-back 토큰 발급용 (X-External-Secret)
//   SERVICE_BACK_BASE_URL   — 'https://www.futuretraining.co.kr:8143/service-back' (상용)
//                              또는 ':8193/service-back' (개발)
//
// 멱등성: service-back이 보장 — 재호출 시 study_end_date만 갱신
// 토큰: 1회 발급 후 service_back_token 테이블에 영구 캐시
// ════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXTERNAL_JWT_SECRET = Deno.env.get('EXTERNAL_JWT_SECRET')!;
const SERVICE_BACK_BASE_URL = Deno.env.get('SERVICE_BACK_BASE_URL')
  || 'https://www.futuretraining.co.kr:8143/service-back';

function corsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin && (
    /\.sfcenter\.co\.kr$/.test(safeHost(origin)) ||
    /\.sfos\.kr$/.test(safeHost(origin)) ||
    safeHost(origin) === 'localhost' ||
    safeHost(origin) === '127.0.0.1'
  );
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin! : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function safeHost(url: string) { try { return new URL(url).hostname; } catch { return ''; } }

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return jsonErr(405, 'Method not allowed', cors);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonErr(400, '입력 JSON 파싱 실패', cors);
  }

  const { payment_fn, training_round } = body;
  if (!payment_fn || typeof training_round !== 'number') {
    return jsonErr(400, '필수 필드: payment_fn, training_round (number)', cors);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  try {
    // ── service-back 토큰 가져오기 (캐시 또는 발급) ──
    let token = await getCachedToken(supabase);
    if (!token) {
      token = await issueNewToken();
      await cacheToken(supabase, token);
    }

    // ── service-back complete API 호출 ──
    let res = await callComplete(token, payment_fn, training_round);

    // 401이면 토큰 만료/회수 가능성 — 재발급 후 1회 재시도
    if (res.status === 401) {
      console.warn('[wordsense-complete] 토큰 401 — 재발급 후 재시도');
      token = await issueNewToken();
      await cacheToken(supabase, token);
      res = await callComplete(token, payment_fn, training_round);
    }

    const resBody = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error('[wordsense-complete] service-back 응답:', res.status, resBody);
      return jsonErr(res.status, resBody.message || 'service-back 호출 실패', cors);
    }

    return new Response(JSON.stringify({
      success: true,
      service_back: resBody,
    }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[wordsense-complete] 실패:', err);
    return jsonErr(500, '서버 오류: ' + (err as Error).message, cors);
  }
});

// ── service-back 토큰 발급 ──
async function issueNewToken(): Promise<string> {
  const res = await fetch(`${SERVICE_BACK_BASE_URL}/api/public/external/token`, {
    method: 'POST',
    headers: { 'X-External-Secret': EXTERNAL_JWT_SECRET },
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`토큰 발급 실패 ${res.status}: ${errBody}`);
  }
  const data = await res.json();
  if (!data.token) throw new Error('토큰 응답에 token 필드 없음');
  return data.token;
}

// ── service-back complete API 호출 ──
async function callComplete(token: string, payment_fn: string, training_round: number) {
  return await fetch(`${SERVICE_BACK_BASE_URL}/api/public/hanja/study/complete`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ payment_fn, training_round }),
  });
}

// ── 토큰 캐시 (Supabase 테이블) ──
async function getCachedToken(supabase: any): Promise<string | null> {
  const { data } = await supabase
    .from('service_back_token')
    .select('token')
    .eq('id', 'singleton')
    .maybeSingle();
  return data?.token || null;
}
async function cacheToken(supabase: any, token: string) {
  await supabase.from('service_back_token')
    .upsert({ id: 'singleton', token, issued_at: new Date().toISOString() },
            { onConflict: 'id' });
}

function jsonErr(status: number, message: string, cors: Record<string, string>) {
  return new Response(JSON.stringify({ success: false, status, message }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
