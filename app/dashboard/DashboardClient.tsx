'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { AgentTable } from '@/components/dashboard/AgentTable'
import { TaskForm } from '@/components/dashboard/TaskForm'
import { LogViewer } from '@/components/dashboard/LogViewer'
import type { AgentDefinition } from '@/types/agent'

interface Profile {
  id: string
  display_name: string
  role: string
  division: string | null
  is_online: boolean
}

interface DashboardClientProps {
  agents: AgentDefinition[]
  profiles: Profile[]
  isCeo: boolean
  canSync: boolean
}

export function DashboardClient({ agents, profiles, isCeo, canSync }: DashboardClientProps) {
  const router = useRouter()
  const supabase = createClient()

  const [assignTarget, setAssignTarget] = useState<AgentDefinition | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [tab, setTab] = useState<'agents' | 'team' | 'tasks'>('agents')
  const [onlineCount, setOnlineCount] = useState(profiles.filter((p) => p.is_online).length)
  const [updatingRole, setUpdatingRole] = useState<string | null>(null)

  // Live online count via realtime
  useEffect(() => {
    const refresh = () => {
      supabase
        .from('profiles')
        .select('id')
        .eq('is_online', true)
        .then(({ data }) => { if (data) setOnlineCount(data.length) })
    }

    const channel = supabase
      .channel('online-count')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, refresh)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      const data = await res.json()
      if (data.synced !== undefined) {
        setSyncResult({ ok: true, message: `Synced ${data.synced}/${data.total} agents` })
        router.refresh()
      } else {
        setSyncResult({ ok: false, message: data.error ?? 'Sync failed' })
      }
    } catch {
      setSyncResult({ ok: false, message: 'Network error — check your connection' })
    } finally {
      setSyncing(false)
    }
  }

  const handleAssignTask = async (agentId: string, title: string, description: string) => {
    const res = await fetch(`/api/agents/${agentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to assign task' }))
      throw new Error(err.error)
    }
    router.refresh()
  }

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdatingRole(userId)
    try {
      const res = await fetch(`/api/profiles/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      if (!res.ok) throw new Error('Failed to update role')
      router.refresh()
    } finally {
      setUpdatingRole(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#0f0f1a]">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center gap-4">
        <Link href="/office" className="text-white/40 hover:text-white transition-colors text-sm">
          ← Office
        </Link>
        <h1 className="text-white font-bold text-lg">Agent Dashboard</h1>
        <div className="flex-1" />
        {canSync && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-colors disabled:opacity-50"
          >
            {syncing ? '⟳ Syncing…' : '⟳ Sync Agents'}
          </button>
        )}
      </header>

      {syncResult && (
        <div
          className={`mx-6 mt-4 px-4 py-3 rounded-xl text-sm border ${
            syncResult.ok
              ? 'bg-green-500/10 border-green-500/30 text-green-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          {syncResult.message}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 p-6 pb-0">
        {[
          { label: 'Total Agents', value: agents.length },
          { label: 'Team Members', value: profiles.length },
          { label: 'Online Now', value: onlineCount },
        ].map((stat) => (
          <div key={stat.label} className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-white/40 text-xs font-medium mb-1">{stat.label}</div>
            <div className="text-white text-2xl font-bold">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="px-6 mt-6 pb-12">
        <div className="flex gap-1 bg-white/5 p-1 rounded-xl w-fit mb-6">
          {(['agents', 'team', 'tasks'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                tab === t ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'agents' && (
          <AgentTable agents={agents} onAssign={setAssignTarget} />
        )}

        {tab === 'team' && (
          <div className="space-y-2">
            {profiles.length === 0 ? (
              <div className="text-center text-white/30 text-sm py-12">No team members yet</div>
            ) : (
              profiles.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl p-4"
                >
                  <div
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      p.is_online ? 'bg-green-400' : 'bg-white/20'
                    }`}
                  />
                  <span className="text-white font-medium flex-1 min-w-0 truncate">
                    {p.display_name}
                  </span>
                  {p.division ? (
                    <span className="text-white/30 text-sm flex-shrink-0">{p.division}</span>
                  ) : null}
                  {isCeo ? (
                    <select
                      value={p.role}
                      disabled={updatingRole === p.id}
                      onChange={(e) => handleRoleChange(p.id, e.target.value)}
                      className="bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-white/70 text-xs focus:outline-none focus:border-violet-400 disabled:opacity-40 cursor-pointer"
                    >
                      <option value="employee">Employee</option>
                      <option value="manager">Manager</option>
                      <option value="ceo">CEO</option>
                    </select>
                  ) : (
                    <span className="text-white/40 text-sm capitalize flex-shrink-0">{p.role}</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'tasks' && (
          <>
            <p className="text-white/40 text-sm mb-4">Live task feed — newest first</p>
            <LogViewer />
          </>
        )}
      </div>

      {assignTarget && (
        <TaskForm
          agent={assignTarget}
          onClose={() => setAssignTarget(null)}
          onSubmit={handleAssignTask}
        />
      )}
    </div>
  )
}
