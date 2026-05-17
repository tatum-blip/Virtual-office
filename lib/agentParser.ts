import matter from 'gray-matter'
import { DIVISION_COLORS, DIVISION_SPRITE_KEYS } from '@/game/config/divisions'
import type { AgentDefinition } from '@/types/agent'

function normalizeDivision(raw: string | undefined, folderPath: string): string {
  if (raw) return raw.toLowerCase().trim()
  const parts = folderPath.split('/')
  return parts.length > 1 ? parts[0].toLowerCase() : 'general'
}

function normalizeCapabilities(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') {
    return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
  }
  return []
}

function deriveName(raw: string | undefined, filePath: string): string {
  if (raw) return raw
  const filename = filePath.split('/').pop()?.replace('.md', '') ?? 'Unknown Agent'
  return filename
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function parseAgentMarkdown(
  filePath: string,
  rawContent: string,
  index: number
): Omit<AgentDefinition, 'id' | 'synced_at'> {
  const { data, content } = matter(rawContent)

  const division = normalizeDivision(data.division, filePath)
  const name = deriveName(data.name, filePath)
  const capabilities = normalizeCapabilities(data.capabilities ?? data.skills ?? data.expertise)

  const spriteIndex = index % 8
  const sprite_key = DIVISION_SPRITE_KEYS[division] ?? `creature_${spriteIndex}`
  const color_hex = DIVISION_COLORS[division] ?? '#94A3B8'

  return {
    github_path: filePath,
    name,
    division,
    description: content.trim().slice(0, 500),
    capabilities,
    sprite_key,
    color_hex,
    raw_markdown: rawContent,
    status: 'idle',
  }
}
