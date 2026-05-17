'use client'
import { useState, useEffect } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Badge } from '@/components/ui/Badge'
import { DIVISION_LABELS } from '@/game/config/divisions'
import type { AgentDefinition } from '@/types/agent'

interface AgentPanelProps {
  agent: AgentDefinition | null
  onClose: () => void
}

function buildClaudeUrl(agent: AgentDefinition): string {
  const systemPrompt = encodeURIComponent(agent.raw_markdown.slice(0, 2000))
  return `https://claude.ai/new?q=${encodeURIComponent(`You are ${agent.name}. ${agent.description.slice(0, 200)}`)}`
}

export function AgentPanel({ agent, onClose }: AgentPanelProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (agent) {
      setVisible(true)
    } else {
      setVisible(false)
    }
  }, [agent])

  if (!agent) return null

  const divisionLabel = DIVISION_LABELS[agent.division] ?? agent.division

  return (
    <div
      className={`fixed right-0 top-0 h-full z-50 transition-transform duration-300 ${
        visible ? 'translate-x-0' : 'translate-x-full'
      }`}
      style={{ width: 360 }}
    >
      <Panel className="h-full rounded-r-none flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <div
          className="p-5 pb-4 flex items-start gap-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}
        >
          {/* Creature icon */}
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0"
            style={{ backgroundColor: agent.color_hex + '33', border: `2px solid ${agent.color_hex}` }}
          >
            🤖
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-lg leading-tight truncate">{agent.name}</h2>
            <div className="mt-1.5">
              <Badge label={divisionLabel} color={agent.color_hex} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors text-xl leading-none mt-0.5"
          >
            ✕
          </button>
        </div>

        {/* Status pill */}
        <div className="px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                agent.status === 'idle'
                  ? 'bg-green-400'
                  : agent.status === 'working'
                  ? 'bg-yellow-400 animate-pulse'
                  : 'bg-blue-400'
              }`}
            />
            <span className="text-white/60 text-sm capitalize">{agent.status}</span>
          </div>
        </div>

        {/* Description */}
        <div className="px-5 py-4 flex-1 overflow-y-auto scrollbar-hide">
          {agent.description && (
            <div className="mb-5">
              <h3 className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">About</h3>
              <p className="text-white/80 text-sm leading-relaxed">{agent.description}</p>
            </div>
          )}

          {agent.capabilities.length > 0 && (
            <div>
              <h3 className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">
                Capabilities
              </h3>
              <ul className="space-y-1.5">
                {agent.capabilities.slice(0, 8).map((cap, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                    <span className="mt-0.5 text-xs" style={{ color: agent.color_hex }}>▸</span>
                    <span>{cap}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="p-5 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <a
            href={buildClaudeUrl(agent)}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-white text-sm transition-all hover:brightness-110 active:scale-95"
            style={{ backgroundColor: agent.color_hex }}
          >
            <span>Chat with {agent.name.split(' ')[0]}</span>
            <span className="text-lg">↗</span>
          </a>
        </div>
      </Panel>
    </div>
  )
}
