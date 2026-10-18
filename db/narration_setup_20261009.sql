-- 나레이션 통합 1단계 — Storage 버킷 + main_chars.narration_url 컬럼 (2026-10-09)
--   안전: 추가형(ADD COLUMN IF NOT EXISTS, 버킷 upsert). 기존 데이터·앱 무영향.
\set ON_ERROR_STOP on
\pset pager off
BEGIN;

-- 1) 공개 Storage 버킷 'narration' (공개 읽기, 업로드는 service_role만 — RLS 기본 차단)
INSERT INTO storage.buckets (id, name, public)
VALUES ('narration', 'narration', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- 2) 글자 단위 나레이션 URL 컬럼
ALTER TABLE public.main_chars ADD COLUMN IF NOT EXISTS narration_url text;

COMMIT;

\echo '=== 버킷 확인 ==='
SELECT id, name, public FROM storage.buckets WHERE id='narration';
\echo '=== 컬럼 확인 ==='
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='main_chars' AND column_name='narration_url';
