-- (2026-10-22) profile에 section(학생 실제 학제) 추가 — 과정이 중등이어도 초4 학생은 '초등학교 4학년'으로
-- 선생님용 훈련결과 데이터 (대표님 2026-10-18) — teacher-result.html 1~3쪽이 한 번에 쓰는 묶음
--   1쪽 나의 훈사전: 영역별 회차(主字·훈음·출제 수·내 어휘 수·훈련 여부·재시도 수)
--   2쪽 영역별 현황: wordsense_student_stats (습득·전체·통과 회차·등급별)
--   3쪽 실력 점검: 차수(5회차 묶음)별 응시 기록 + 회차별 정답 수 — 대표 점수는 '최고 점수'(화면에서 고름)
--   학생 기록이라 service_role만 (Edge wordsense-unittest 'teacher' 액션·sf-admin이 부름)
CREATE OR REPLACE FUNCTION public.wordsense_teacher_report(p_member_no bigint, p_level text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  lv text;
  out_areas jsonb := '[]'::jsonb;
  ar record;
  prog jsonb;
BEGIN
  -- 과정: 지정 없으면 가장 최근 훈련의 과정
  lv := coalesce(p_level,
    (SELECT s.level FROM attempts a JOIN sessions s ON s.id = a.session_id
      WHERE a.member_no = p_member_no ORDER BY a.finished_at DESC NULLS LAST, a.id DESC LIMIT 1), '초등');

  FOR ar IN SELECT id, slug, name_ko FROM areas ORDER BY display_order LOOP
    prog := wordsense_area_progress(p_member_no, ar.id, lv);   -- 영역마다 한 번만 계산
    out_areas := out_areas || jsonb_build_array(jsonb_build_object(
      'slug', ar.slug, 'name', ar.name_ko,
      'rounds', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'r', s.round_no, 'c', s.main_char, 'h', mc.char_hangul,
                 'total', (p->>'total')::int, 'known', (p->>'known')::int, 'trained', (p->>'trained')::boolean,
                 'retry', greatest(0, (SELECT count(*) FROM attempts a WHERE a.member_no = p_member_no AND a.session_id = s.id AND a.finished_at IS NOT NULL) - 1)
               ) ORDER BY s.round_no), '[]'::jsonb)
        FROM sessions s
        LEFT JOIN main_chars mc ON mc.char = s.main_char
        LEFT JOIN LATERAL (
          SELECT x AS p FROM jsonb_array_elements(prog) x
          WHERE (x->>'round')::int = s.round_no
        ) pr ON true
        WHERE s.area_id = ar.id AND s.level = lv
      ),
      'first', (SELECT min(a.finished_at)::date FROM attempts a JOIN sessions s ON s.id = a.session_id
                WHERE a.member_no = p_member_no AND s.area_id = ar.id AND s.level = lv AND a.finished_at IS NOT NULL),
      'last',  (SELECT max(a.finished_at)::date FROM attempts a JOIN sessions s ON s.id = a.session_id
                WHERE a.member_no = p_member_no AND s.area_id = ar.id AND s.level = lv AND a.finished_at IS NOT NULL)
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'member_no', p_member_no,
    'level', lv,
    'profile', (
      SELECT jsonb_build_object(
        'name', coalesce(st.name, pc.name),
        'grade', coalesce(st.school_grade::text, pc.grade::text),
        'section', coalesce(st.section::text, pc.school_level::text),   -- 학생 실제 학제(1 초등·2 중등·3 고등 등) — 결과지 '○○학교 N학년'용 (2026-10-22)
        'academy', coalesce(ac.name, pc.center))
      FROM (SELECT 1) one
      LEFT JOIN students st ON st.user_no = p_member_no
      LEFT JOIN academies ac ON ac.academy_no = st.academy_no
      LEFT JOIN user_profile_cache pc ON pc.member_no = p_member_no
    ),
    'stats', wordsense_student_stats(p_member_no, lv),
    'areas', out_areas,
    'tests', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id, 'area', a2.slug, 'unit', t.unit, 'score', t.score,
               'at', (t.finished_at AT TIME ZONE 'Asia/Seoul')::date, 'duration_ms', t.duration_ms,
               'n_known', t.n_known, 'n_hanja', t.n_hanja, 'n_hanja_wrong', t.n_hanja_wrong, 'n_wrong', t.n_wrong,
               'rounds', (SELECT coalesce(jsonb_agg(jsonb_build_object('r', x.round_no, 'n', x.n, 'ok', x.ok) ORDER BY x.round_no), '[]'::jsonb)
                          FROM (SELECT round_no, count(*) AS n, count(*) FILTER (WHERE result IN ('known', 'hanja')) AS ok
                                FROM test_answers WHERE attempt_id = t.id GROUP BY round_no) x)
             ) ORDER BY t.finished_at)
      FROM test_attempts t JOIN areas a2 ON a2.id = t.area_id
      WHERE t.member_no = p_member_no AND t.level = lv AND t.status = 'done'
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.wordsense_teacher_report(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wordsense_teacher_report(bigint, text) TO service_role;
