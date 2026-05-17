# Agency HQ — Setup Guide

Complete in order. Takes ~30 minutes.

---

## 1. Supabase (Database + Auth)

1. Go to [supabase.com](https://supabase.com) → New project
2. Name it `agency-hq`, pick a region close to you, set a strong password
3. Once created, go to **Settings → API**:
   - Copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - Copy **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Go to **SQL Editor** and run both migration files in order:
   - Paste contents of `supabase/migrations/001_initial_schema.sql` → Run
   - Paste contents of `supabase/migrations/002_rls_policies.sql` → Run
5. Go to **Authentication → Providers**:
   - Enable **Email** (magic link is on by default)
   - Optionally enable **Google** (requires Google Cloud OAuth credentials)
6. Go to **Authentication → URL Configuration**:
   - Add `http://localhost:3000/**` to Redirect URLs
   - Add your Vercel URL `https://your-app.vercel.app/**` later

---

## 2. Daily.co (Video calls)

1. Go to [daily.co](https://www.daily.co) → Sign up free
2. Create a domain (this is your subdomain, e.g. `myagency`)
3. Copy the **subdomain** (not the full URL) → `NEXT_PUBLIC_DAILY_DOMAIN`
4. Rooms are created automatically per office room name

---

## 3. GitHub Token (Agent sync)

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Generate a new **fine-grained token** with **Contents: Read** on public repos
3. Copy it → `GITHUB_TOKEN`

---

## 4. Environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in your values:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
NEXT_PUBLIC_DAILY_DOMAIN=myagency
GITHUB_TOKEN=github_pat_xxxx
```

---

## 5. Run locally

```bash
# Install nvm + Node if not done:
# curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# nvm install 20

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 6. Set yourself as CEO

After signing in for the first time:

1. Go to Supabase → **Table Editor → profiles**
2. Find your row (by email or `display_name`)
3. Set `role` → `ceo`
4. Save

Now you have access to the Dashboard at `/dashboard`.

---

## 7. Sync agents

1. Go to `/dashboard`
2. Click **"Sync Agents"** — this fetches all 144 agents from GitHub and populates the database
3. Refresh `/office` — agents will appear as colored creatures in the office

---

## 8. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

Or connect your GitHub repo at [vercel.com/new](https://vercel.com/new) and add environment variables in the Vercel dashboard under **Settings → Environment Variables**.

---

## 9. Add team members

Share the Vercel URL. Team members sign in with their email (magic link). Then:
1. Dashboard → Team tab → find their name
2. Set their role (`employee`, `manager`, `ceo`)
3. To grant agent dashboard access without full manager role:
   - Supabase → Table Editor → permissions
   - Insert: `user_id` = their profile ID, `resource` = `agent_dashboard`, `granted_by` = your profile ID

---

## Troubleshooting

**"No agents in office"** → Go to Dashboard and click Sync Agents

**"Redirect loop"** → Check Supabase URL config has your redirect URL listed

**"Video not working"** → Check Daily.co domain is correct (just the subdomain, not full URL)

**"Can't reach Dashboard"** → Make sure your `role` is set to `ceo` in Supabase profiles table
