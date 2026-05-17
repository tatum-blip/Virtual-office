-- Allow CEO to update any profile (needed for role management in dashboard)
create policy "CEO can update any profile"
  on public.profiles for update using (public.get_my_role() = 'ceo');
