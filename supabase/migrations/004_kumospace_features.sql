-- Kumospace-style features: window views, decorations, agent permissions, photo avatars
-- Run this in Supabase Studio → SQL Editor → New Query, paste, run.
-- Idempotent: safe to run multiple times.

-- ──────────────────────────────────────────────────────────────
-- 1. profiles: add can_decorate column FIRST so later policies can reference it
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_decorate BOOLEAN DEFAULT false;

-- ──────────────────────────────────────────────────────────────
-- 2. office_settings — key/value store synced across all users
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.office_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.office_settings (key, value) VALUES
  ('window_view',     'city_day'),
  ('agent_roam_main', 'false')
ON CONFLICT (key) DO NOTHING;

-- Realtime is required for cross-client sync of window views + agent roam toggle
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.office_settings;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.office_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "office_settings select" ON public.office_settings;
CREATE POLICY "office_settings select" ON public.office_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "office_settings upsert by managers" ON public.office_settings;
CREATE POLICY "office_settings upsert by managers" ON public.office_settings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('ceo','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('ceo','manager')));

-- ──────────────────────────────────────────────────────────────
-- 3. floor_decorations — placed items, one row per object
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.floor_decorations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor       TEXT NOT NULL DEFAULT 'main',         -- 'main' | 'agent'
  type        TEXT NOT NULL,
  x           DOUBLE PRECISION NOT NULL,
  y           DOUBLE PRECISION NOT NULL,
  rotation    DOUBLE PRECISION DEFAULT 0,
  placed_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS floor_decorations_floor_idx ON public.floor_decorations (floor);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.floor_decorations;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.floor_decorations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "decorations select" ON public.floor_decorations;
CREATE POLICY "decorations select" ON public.floor_decorations
  FOR SELECT TO authenticated USING (true);

-- Only users with can_decorate (or CEO/manager) can insert/update/delete
DROP POLICY IF EXISTS "decorations write by permitted users" ON public.floor_decorations;
CREATE POLICY "decorations write by permitted users" ON public.floor_decorations
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.role IN ('ceo','manager') OR p.can_decorate = true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.role IN ('ceo','manager') OR p.can_decorate = true)
  ));

-- ──────────────────────────────────────────────────────────────
-- 4. Supabase Storage bucket for photo-circle avatars
-- ──────────────────────────────────────────────────────────────
-- Public read so video bubbles + game avatars can load any user's photo
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Avatar images are publicly readable" ON storage.objects;
CREATE POLICY "Avatar images are publicly readable" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'avatars');

-- Each user can upload/update/delete their own avatar (path prefix = their auth uid)
DROP POLICY IF EXISTS "Users upload their own avatar" ON storage.objects;
CREATE POLICY "Users upload their own avatar" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users update their own avatar" ON storage.objects;
CREATE POLICY "Users update their own avatar" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users delete their own avatar" ON storage.objects;
CREATE POLICY "Users delete their own avatar" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
