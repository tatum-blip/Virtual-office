import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { fetchAgentFiles } from '@/lib/github'
import { parseAgentMarkdown } from '@/lib/agentParser'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: agents, error } = await supabase.from('agents').select('*').order('division')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(agents)
}

export async function POST(req: Request) {
  const { action } = await req.json().catch(() => ({ action: '' }))

  if (action !== 'sync') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  // Auth check — only CEO can trigger sync
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['ceo', 'manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const files = await fetchAgentFiles()
    let synced = 0

    for (let i = 0; i < files.length; i++) {
      const { path, content } = files[i]
      const parsed = parseAgentMarkdown(path, content, i)

      const { error } = await supabase.from('agents').upsert(
        { ...parsed, synced_at: new Date().toISOString() },
        { onConflict: 'github_path' }
      )

      if (!error) synced++
    }

    return NextResponse.json({ synced, total: files.length })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
