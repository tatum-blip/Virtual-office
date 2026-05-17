'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { DIVISION_COLORS } from '@/game/config/divisions'
import type { AgentTask } from '@/types/agent'

interface LogViewerProps {
  agentId?: string
}

const STATUS_STYLES: Record<AgentTask['status'], string> = {
  queued: 'text-white/40 bg-white/5',
  running: 'text-yellow-400 bg-yellow-400/10',
  done: 'text-green-400 bg-green-400/10',
  failed: 'text-red-400 bg-red-400/10',
}

export function LogViewer({ agentId }: LogViewerProps) {
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const supabase = createClient()

  useEffect(() => {
    const fetchTasks = async () => {
      let query = supabase
        .from('agent_tasks')
        .select('*, agents(name, division, color_hex)')
        .order('created_at', { ascending: false })
        .limit(50)

      if (agentId) query = query.eq('agent_id', agentId)

      const { data } = await query
      if (data) setTasks(data as AgentTask[])
    }

    fetchTasks()

    const channel = supabase
      .channel('task-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_tasks' },
        (payload) => {
          setTasks((prev) => {
            const updated = payload.new as AgentTask
            const idx = prev.findIndex((t) => t.id === updated.id)
            if (idx >= 0) {
              const next = [...prev]
              // Preserve the nested agents data from the existing record
              next[idx] = { ...prev[idx], ...updated }
              return next
            }
            return [updated, ...prev].slice(0, 50)
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [agentId])

  if (tasks.length === 0) {
    return (
      <div className="text-center text-white/30 text-sm py-12">
        No tasks yet — assign one from the Agents tab
      </div>
    )
  }

  return (
    <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
      {tasks.map((task) => {
        const agentColor = task.agents?.color_hex ?? '#94A3B8'
        return (
          <div
            key={task.id}
            className="bg-white/5 border border-white/10 rounded-xl p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                {task.agents && (
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: agentColor }}
                    />
                    <span
                      className="text-xs font-medium"
                      style={{ color: agentColor }}
                    >
                      {task.agents.name}
                    </span>
                  </div>
                )}
                <p className="text-white text-sm font-medium leading-snug">{task.title}</p>
                {task.description && (
                  <p className="text-white/50 text-xs mt-1">{task.description}</p>
                )}
              </div>
              <span className={`text-xs capitalize flex-shrink-0 px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[task.status]}`}>
                {task.status}
              </span>
            </div>

            {task.log_output && (
              <pre className="mt-3 text-xs text-green-300/80 bg-black/30 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">
                {task.log_output}
              </pre>
            )}
            <p className="text-white/25 text-xs mt-2">
              {new Date(task.created_at).toLocaleString()}
            </p>
          </div>
        )
      })}
    </div>
  )
}
