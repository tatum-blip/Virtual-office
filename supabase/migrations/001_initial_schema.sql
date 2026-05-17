-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (extends auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  role text not null default 'employee' check (role in ('employee', 'manager', 'ceo')),
  division text,
  room_id uuid,
  is_online boolean not null default false,
  avatar_index int not null default 0,
  created_at timestamptz not null default now()
);

-- Rooms
create table public.rooms (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  type text not null default 'personal' check (type in ('personal', 'meeting', 'kitchen', 'lounge', 'open_plan')),
  owner_id uuid references public.profiles(id) on delete set null,
  tile_x int not null default 0,
  tile_y int not null default 0,
  width int not null default 4,
  height int not null default 4,
  capacity int not null default 10,
  created_at timestamptz not null default now()
);

-- Add FK from profiles to rooms
alter table public.profiles add constraint profiles_room_id_fkey
  foreign key (room_id) references public.rooms(id) on delete set null;

-- Agents (populated from GitHub)
create table public.agents (
  id uuid primary key default uuid_generate_v4(),
  github_path text unique not null,
  name text not null,
  division text not null,
  description text not null default '',
  capabilities text[] not null default '{}',
  sprite_key text not null default 'creature_0',
  color_hex text not null default '#94A3B8',
  raw_markdown text not null default '',
  status text not null default 'idle' check (status in ('idle', 'working', 'in_meeting')),
  synced_at timestamptz not null default now()
);

-- Agent tasks
create table public.agent_tasks (
  id uuid primary key default uuid_generate_v4(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  log_output text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Permissions
create table public.permissions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  resource text not null,
  granted_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, resource)
);

-- Updated_at trigger for agent_tasks
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_agent_tasks_updated_at
  before update on public.agent_tasks
  for each row execute function public.set_updated_at();

-- Default rooms
insert into public.rooms (name, type, tile_x, tile_y, width, height) values
  ('Open Plan', 'open_plan', 1, 1, 38, 28),
  ('Meeting Room A', 'meeting', 40, 1, 19, 18),
  ('Kitchen', 'kitchen', 60, 1, 19, 14),
  ('Lounge', 'lounge', 60, 16, 19, 13);
