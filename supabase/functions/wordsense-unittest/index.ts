// ════════════════════════════════════════════════════════════════
// Edge Function: wordsense-unittest — 실력 점검 (기획 v7, 2026-10-17)
//
//   학생 확인: 학원 입장권(session_init.id)으로 회원번호를 서버에서 읽음 (브라우저가 보낸 회원번호는 믿지 않음)
//   이어 하기: start 때 25문항을 test_answers에 미리 만들고, hint/answer 때마다 저장
//   점수: 한글만 보고 정답 4점(known) · 한자 보고 풀어 정답 2점(hanja) · 그 외 0점 → 100점 만점
//
// 입력 (POST JSON): { action, ticket, ... }
//   status  { level, area_id }                         → 단원별 응시 결과·훈련한 회차·진행 중 평가
//   start   { level, area_id, unit, items[25] }        → 진행 중이 있으면 그것을, 없으면 새로 (5회차 모두 통과해야)
//   hint    { attempt_id, ord }                        → '한자 보고 풀기' 누름 저장
//   answer  { attempt_id, ord, choice_idx, ms }        → 결과는 서버가 판정
//   finish  { attempt_id }                             → 25문항 다 답했으면 점수 계산·완료
//   report  {}                                         → (옛) 실력 점검 보고서용 — 끝난 점검 전부 + 문항 결과
//   teacher { level? }                                 → 선생님용 훈련결과 1~3쪽 묶음 (wordsense_teacher_report)
// ════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TICKET_MS = 6 * 3600 * 1000;   // 입장권을 연 뒤 6시간까지 (훈련 + 평가)
const N_ITEMS = 25;

function safeHost(url: string) { try { return new URL(url).hostname; } catch { return ''; } }
function corsHeaders(origin: string | null): Record<string, string> {
  const h = origin ? safeHost(origin) : '';
  const ok = !!h && (/\.sfcenter\.co\.kr$/.test(h) || /\.sfos\.kr$/.test(h) || h === 'localhost' || h === '127.0.0.1');
  return {
    'Access-Control-Allow-Origin': ok ? origin! : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization',
    'Vary': 'Origin',
  };
}
const unitRounds = (unit: number) => ({ from: (unit - 1) * 5 + 1, to: unit * 5 });

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return err(405, 'Method not allowed', cors);
  let b: any;
  try { b = await req.json(); } catch { return err(400, '입력 JSON 파싱 실패', cors); }
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    // ── 학생 확인 (입장권) ──
    if (!b.ticket) return err(400, '입장권이 필요합니다', cors);
    const { data: t } = await db.from('session_init').select('id, user_no, used_at, created_at').eq('id', b.ticket).maybeSingle();
    if (!t || !t.user_no) return err(403, '입장권을 확인할 수 없습니다', cors);
    const opened = new Date(t.used_at || t.created_at).getTime();
    if (Date.now() - opened > TICKET_MS) return err(403, '입장권 시간이 지났습니다', cors);
    const member = Number(t.user_no);

    // 학생이 훈련을 마친 회차 번호 (이 영역·과정)
    const trainedRounds = async (level: string, areaId: number) => {
      const { data: ss } = await db.from('sessions').select('id, round_no').eq('area_id', areaId).eq('level', level);
      const roundOf = new Map((ss || []).map((s: any) => [s.id, s.round_no]));
      const { data: at } = await db.from('attempts').select('session_id').eq('member_no', member)
        .in('session_id', [...roundOf.keys()]).not('finished_at', 'is', null);
      return [...new Set((at || []).map((a: any) => roundOf.get(a.session_id)).filter(Boolean))].sort((x: any, y: any) => x - y);
    };
    // 학생이 통과한 회차 번호 — 훈련한 회차 중 어휘의 80% 이상이 내 어휘 (훈사전과 같은 기준, 2026-10-17)
    const passedRounds = async (level: string, areaId: number) => {
      const { data } = await db.rpc('wordsense_area_progress', { p_member_no: member, p_area_id: areaId, p_level: level });
      return ((data || []) as any[]).filter(p => p.trained && p.total > 0 && p.known * 10 >= p.total * 8).map(p => p.round);
    };
    const loadAttempt = async (id: number) => {
      const { data: a } = await db.from('test_attempts').select('*').eq('id', id).eq('member_no', member).maybeSingle();
      if (!a) return null;
      const { data: items } = await db.from('test_answers')
        .select('ord, session_word_id, word_master_id, round_no, grade, word, hanja, hun, choices, hanja_used, choice_idx, result')
        .eq('attempt_id', id).order('ord');
      return { ...a, items: items || [] };   // correct_idx는 보내지 않음 (끝난 뒤 해설은 finish에서)
    };

    if (b.action === 'status') {
      const level = b.level === '중등' ? '중등' : '초등', areaId = Number(b.area_id);
      const [rounds, passed, { data: atts }] = await Promise.all([
        trainedRounds(level, areaId),
        passedRounds(level, areaId),
        db.from('test_attempts').select('id, unit, status, score, started_at, finished_at')
          .eq('member_no', member).eq('level', level).eq('area_id', areaId).order('started_at'),
      ]);
      const units: Record<string, any> = {};
      for (const a of (atts || [])) {
        const u = units[a.unit] || (units[a.unit] = { unit: a.unit, tries: 0, first: null, last: null, best: null, open_id: null });
        if (a.status === 'in_progress') { u.open_id = a.id; continue; }
        u.tries++;
        if (u.first == null) u.first = a.score;
        u.last = a.score;
        u.best = Math.max(u.best ?? 0, a.score ?? 0);
      }
      return ok({ trained_rounds: rounds, passed_rounds: passed, units: Object.values(units) }, cors);
    }

    if (b.action === 'start') {
      const level = b.level === '중등' ? '중등' : '초등', areaId = Number(b.area_id), unit = Number(b.unit);
      const { from, to } = unitRounds(unit);
      // 진행 중이면 그대로 이어 하기
      const { data: open } = await db.from('test_attempts').select('id').eq('member_no', member)
        .eq('level', level).eq('area_id', areaId).eq('unit', unit).eq('status', 'in_progress').maybeSingle();
      if (open) return ok({ resumed: true, attempt: await loadAttempt(open.id) }, cors);
      // 응시 자격: 단원 5회차 모두 통과 (어휘 80% 이상, 2026-10-17)
      const rounds = await passedRounds(level, areaId);
      const missing = [];
      for (let r = from; r <= to; r++) if (!rounds.includes(r)) missing.push(r);
      if (missing.length) return err(409, `아직 통과하지 않은 회차가 있어요: ${missing.join(', ')}회`, cors, 'not_eligible');
      const items = Array.isArray(b.items) ? b.items.slice(0, N_ITEMS) : [];
      if (items.length < 1) return err(400, '문항이 없습니다', cors);
      const { data: a, error: e1 } = await db.from('test_attempts').insert({
        member_no: member, level, area_id: areaId, unit, round_from: from, round_to: to, session_init_id: t.id,
      }).select('id').single();
      if (e1) {   // 동시에 두 번 시작 → 고유 인덱스 충돌이면 이미 열린 것을 돌려줌
        const { data: again } = await db.from('test_attempts').select('id').eq('member_no', member)
          .eq('level', level).eq('area_id', areaId).eq('unit', unit).eq('status', 'in_progress').maybeSingle();
        if (again) return ok({ resumed: true, attempt: await loadAttempt(again.id) }, cors);
        throw e1;
      }
      const rows = items.map((it: any, i: number) => ({
        attempt_id: a.id, ord: i + 1,
        session_word_id: Number(it.session_word_id), word_master_id: Number(it.word_master_id),
        round_no: Number(it.round_no), grade: it.grade != null ? Number(it.grade) : null,
        word: String(it.word), hanja: it.hanja || null, hun: it.hun || null,
        choices: it.choices, correct_idx: Number(it.correct_idx),
      }));
      const { error: e2 } = await db.from('test_answers').insert(rows);
      if (e2) { await db.from('test_attempts').delete().eq('id', a.id); throw e2; }
      return ok({ resumed: false, attempt: await loadAttempt(a.id) }, cors);
    }

    // 선생님용 훈련결과 (teacher-result.html?st=입장권) — 1쪽 훈사전·2쪽 영역별 현황·3쪽 실력 점검 한 묶음 (2026-10-18)
    if (b.action === 'teacher') {
      const { data: report, error } = await db.rpc('wordsense_teacher_report', { p_member_no: member, p_level: b.level || null });
      if (error) throw error;
      return ok({ report }, cors);
    }

    // 선생님 결과 보고서 (unit-report.html?st=입장권) — 이 학생의 끝난 평가 전부 + 문항 결과 (대표님 2026-10-17)
    //   학원 사이트가 훈련 진입과 같은 방식으로 입장권을 만들어 보고서를 엶 → 회원번호는 서버가 입장권에서 읽음
    if (b.action === 'report') {
      const [{ data: atts }, { data: areas }, { data: prof }] = await Promise.all([
        db.from('test_attempts').select('id, level, area_id, unit, round_from, round_to, started_at, finished_at, duration_ms, n_known, n_hanja, n_hanja_wrong, n_wrong, score')
          .eq('member_no', member).eq('status', 'done').order('finished_at'),
        db.from('areas').select('id, slug, name_ko').order('display_order'),
        db.from('user_profile_cache').select('name, school_level, grade, center').eq('member_no', member).maybeSingle(),
      ]);
      const ids = (atts || []).map((a: any) => a.id);
      let answers: any[] = [];
      for (let i = 0; i < ids.length; i += 200) {   // 평가가 많아도 나눠서
        const { data } = await db.from('test_answers')
          .select('attempt_id, ord, round_no, grade, word, hanja, choices, correct_idx, result')
          .in('attempt_id', ids.slice(i, i + 200)).order('attempt_id').order('ord');
        answers = answers.concat(data || []);
      }
      return ok({ member_no: member, profile: prof || null, areas: areas || [], attempts: atts || [], answers }, cors);
    }

    // 이하: 진행 중인 내 평가만
    const attemptId = Number(b.attempt_id);
    const { data: att } = await db.from('test_attempts').select('id, status, duration_ms')
      .eq('id', attemptId).eq('member_no', member).maybeSingle();
    if (!att) return err(404, '실력 점검을 찾을 수 없습니다', cors);

    if (b.action === 'hint') {
      if (att.status !== 'in_progress') return err(409, '이미 끝난 실력 점검입니다', cors);
      await db.from('test_answers').update({ hanja_used: true })
        .eq('attempt_id', attemptId).eq('ord', Number(b.ord)).is('choice_idx', null);
      return ok({}, cors);
    }

    if (b.action === 'answer') {
      if (att.status !== 'in_progress') return err(409, '이미 끝난 실력 점검입니다', cors);
      const ord = Number(b.ord), choice = Number(b.choice_idx);
      const { data: q } = await db.from('test_answers').select('correct_idx, hanja_used, choice_idx')
        .eq('attempt_id', attemptId).eq('ord', ord).maybeSingle();
      if (!q) return err(404, '문항을 찾을 수 없습니다', cors);
      if (q.choice_idx != null) return ok({ already: true }, cors);   // 같은 문항 두 번 답하기 방지
      const right = choice === q.correct_idx;
      const result = q.hanja_used ? (right ? 'hanja' : 'hanja_wrong') : (right ? 'known' : 'wrong');
      const ms = Math.max(0, Math.min(Number(b.ms) || 0, 10 * 60 * 1000));
      await db.from('test_answers').update({ choice_idx: choice, result, ms, answered_at: new Date().toISOString() })
        .eq('attempt_id', attemptId).eq('ord', ord).is('choice_idx', null);
      await db.from('test_attempts').update({ duration_ms: (att.duration_ms || 0) + ms }).eq('id', attemptId);
      return ok({}, cors);
    }

    if (b.action === 'finish') {
      const { data: all } = await db.from('test_answers')
        .select('ord, word, hanja, hun, choices, correct_idx, choice_idx, hanja_used, result, round_no, grade')
        .eq('attempt_id', attemptId).order('ord');
      const list = all || [];
      if (att.status === 'in_progress') {
        if (list.some((x: any) => x.choice_idx == null)) return err(409, '아직 답하지 않은 문항이 있습니다', cors, 'unanswered');
        const c = (r: string) => list.filter((x: any) => x.result === r).length;
        const n = { n_known: c('known'), n_hanja: c('hanja'), n_hanja_wrong: c('hanja_wrong'), n_wrong: c('wrong') };
        const score = Math.round((n.n_known * 4 + n.n_hanja * 2) * 100 / (list.length * 4));
        await db.from('test_attempts').update({ ...n, score, status: 'done', finished_at: new Date().toISOString() })
          .eq('id', attemptId).eq('status', 'in_progress');
      }
      const done = await db.from('test_attempts').select('*').eq('id', attemptId).single();
      return ok({ attempt: done.data, answers: list }, cors);   // 끝난 뒤라 정답 포함 (해설용)
    }

    return err(400, '알 수 없는 action', cors);
  } catch (e) {
    console.error('[wordsense-unittest]', e);
    return err(500, '서버 오류: ' + (e as Error).message, cors);
  }
});

function ok(data: any, cors: Record<string, string>) {
  return new Response(JSON.stringify({ success: true, ...data }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function err(status: number, message: string, cors: Record<string, string>, code?: string) {
  return new Response(JSON.stringify({ success: false, status, message, code: code || null }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
