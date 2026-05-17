-- Enable RLS
alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.agents enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.permissions enable row level security;

-- Helper: get current user role
create or replace function public.get_my_role()
returns text language sql security definer stable as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Helper: check if user has a permission
create or replace function public.has_permission(resource_name text)
returns boolean language sql security definer stable as $$
  select exists(
    select 1 from public.permissions
    where user_id = auth.uid() and resource = resource_name
  )
$$;

-- PROFILES policies
create policy "Users can read all profiles"
  on public.profiles for select using (auth.uid() is not null);

create policy "Users can update their own profile"
  on public.profiles for update using (id = auth.uid());

create policy "Users can insert their own profile"
  on public.profiles for insert with check (id = auth.uid());

-- ROOMS policies
create policy "All authenticated users can read rooms"
  on public.rooms for select using (auth.uid() is not null);

create policy "CEO can manage rooms"
  on public.rooms for all using (public.get_my_role() = 'ceo');

-- AGENTS policies
create policy "All authenticated users can read agents"
  on public.agents for select using (auth.uid() is not null);

create policy "CEO and managers can upsert agents"
  on public.agents for insert with check (
    public.get_my_role() in ('ceo', 'manager')
  );

create policy "CEO and managers can update agents"
  on public.agents for update using (
    public.get_my_role() in ('ceo', 'manager')
  );

-- AGENT_TASKS policies
create policy "CEO and permitted users can read tasks"
  on public.agent_tasks for select using (
    public.get_my_role() in ('ceo', 'manager')
    or public.has_permission('agent_dashboard')
  );

create policy "CEO and permitted users can insert tasks"
  on public.agent_tasks for insert with check (
    public.get_my_role() in ('ceo', 'manager')
    or public.has_permission('agent_dashboard')
  );

create policy "CEO can update tasks"
  on public.agent_tasks for update using (
    public.get_my_role() in ('ceo', 'manager')
  );

-- PERMISSIONS policies
create policy "CEO can manage permissions"
  on public.permissions for all using (public.get_my_role() = 'ceo');

create policy "Users can read their own permissions"
  on public.permissions for select using (user_id = auth.uid());
