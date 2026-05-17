'use client'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { DIVISION_COLORS, DIVISION_LABELS } from '@/game/config/divisions'
import type { AgentDefinition } from '@/types/agent'

interface AgentTableProps {
  agents: AgentDefinition[]
  onAssign: (agent: AgentDefinition) => void
}

const STATUS_COLORS = {
  idle: 'text-green-400',
  working: 'text-yellow-400',
  in_meeting: 'text-blue-400',
}

export function AgentTable({ agents, onAssign }: AgentTableProps) {
  const [search, setSearch] = useState('')
  const [divisionFilter, setDivisionFilter] = useState('')

  const divisions = Array.from(new Set(agents.map((a) => a.division))).sort()

  const filtered = agents.filter((a) => {
    const matchSearch =
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.division.toLowerCase().includes(search.toLowerCase())
    const matchDiv = divisionFilter ? a.division === divisionFilter : true
    return matchSearch && matchDiv
  })

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Search agents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm placeholder-white/40 focus:outline-none focus:border-violet-400"
        />
        <select
          value={divisionFilter}
          onChange={(e) => setDivisionFilter(e.target.value)}
          className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-400"
        >
          <option value="">All Divisions</option>
          {divisions.map((d) => (
            <option key={d} value={d}>
              {DIVISION_LABELS[d] ?? d}
            </option>
          ))}
        </select>
      </div>

      <div className="text-white/40 text-xs mb-3">{filtered.length} agents</div>

      {filtered.length === 0 ? (
        <div className="text-center text-white/30 text-sm py-12 border border-white/10 rounded-xl">
          No agents match your search
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left text-white/50 font-medium px-4 py-3">Name</th>
                <th className="text-left text-white/50 font-medium px-4 py-3">Division</th>
                <th className="text-left text-white/50 font-medium px-4 py-3">Status</th>
                <th className="text-left text-white/50 font-medium px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((agent) => (
                <tr
                  key={agent.id}
                  className="border-b border-white/5 hover:bg-white/5 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-6 h-6 rounded-md flex-shrink-0"
                        style={{ backgroundColor: agent.color_hex + '33', border: `1px solid ${agent.color_hex}` }}
                      />
                      <span className="text-white font-medium">{agent.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      label={DIVISION_LABELS[agent.division] ?? agent.division}
                      color={DIVISION_COLORS[agent.division] ?? '#94A3B8'}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`capitalize ${STATUS_COLORS[agent.status]}`}>
                      {agent.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onAssign(agent)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-white/20 text-white/70 hover:text-white hover:border-violet-400 transition-colors"
                    >
                      Assign Task
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
