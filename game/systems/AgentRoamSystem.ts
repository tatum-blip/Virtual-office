import type { AgentDefinition } from '@/types/agent'
import { TILE_SIZE } from '@/game/config/gameConfig'

// ──────────────────────────────────────────────────────────────
// Main floor rooms (Kumospace-style layout, 52×30 tiles)
// ──────────────────────────────────────────────────────────────
export const MAIN_FLOOR_ROOMS = [
  { name: 'open_plan',      x1: 4,  y1: 2,  x2: 21, y2: 11 },
  { name: 'breakout_1',     x1: 4,  y1: 13, x2: 13, y2: 21 },
  { name: 'center_meeting', x1: 15, y1: 13, x2: 29, y2: 21 },
  { name: 'lounge',         x1: 4,  y1: 22, x2: 29, y2: 26 },
  { name: 'corner_office',  x1: 32, y1: 2,  x2: 49, y2: 17 },
  { name: 'breakout_2',     x1: 32, y1: 19, x2: 49, y2: 26 },
] as const

// ──────────────────────────────────────────────────────────────
// Agent floor (downstairs) — same map dimensions
// ──────────────────────────────────────────────────────────────
export const AGENT_FLOOR_ROOMS = [
  { name: 'agent_hub',      x1: 4,  y1: 2,  x2: 29, y2: 16 },
  { name: 'server_room',    x1: 4,  y1: 17, x2: 16, y2: 26 },
  { name: 'briefing_room',  x1: 18, y1: 17, x2: 29, y2: 26 },
  { name: 'neural_core',    x1: 32, y1: 2,  x2: 49, y2: 26 },
] as const

// Backwards-compat export — default OFFICE_ROOMS = main floor
export const OFFICE_ROOMS = MAIN_FLOOR_ROOMS

export function getRoomsForFloor(floor: 'main' | 'agent') {
  return floor === 'agent' ? AGENT_FLOOR_ROOMS : MAIN_FLOOR_ROOMS
}

export function getRoomPixelBounds(floor: 'main' | 'agent') {
  return getRoomsForFloor(floor).map((r) => ({
    name: r.name,
    px1: r.x1 * TILE_SIZE,
    py1: r.y1 * TILE_SIZE,
    px2: r.x2 * TILE_SIZE,
    py2: r.y2 * TILE_SIZE,
  }))
}

// Backwards-compat
export const ROOM_PIXEL_BOUNDS = getRoomPixelBounds('main')

export type RoomBounds = { x1: number; y1: number; x2: number; y2: number }

/**
 * Returns roaming bounds (in pixels) for an agent at the given index.
 * If `allowMainFloor` is true, agents can also roam main floor open areas.
 */
export function getAgentRoomBounds(agentIndex: number, allowMainFloor = false): RoomBounds {
  const rooms = allowMainFloor
    ? [AGENT_FLOOR_ROOMS[0], AGENT_FLOOR_ROOMS[3], MAIN_FLOOR_ROOMS[0], MAIN_FLOOR_ROOMS[3]]
    : [AGENT_FLOOR_ROOMS[0], AGENT_FLOOR_ROOMS[3]]
  const room = rooms[agentIndex % rooms.length]
  return {
    x1: room.x1 * TILE_SIZE + TILE_SIZE,
    y1: room.y1 * TILE_SIZE + TILE_SIZE,
    x2: room.x2 * TILE_SIZE - TILE_SIZE,
    y2: room.y2 * TILE_SIZE - TILE_SIZE,
  }
}

export function getAgentSpawnPosition(agent: AgentDefinition, index: number, allowMainFloor = false) {
  const bounds = getAgentRoomBounds(index, allowMainFloor)
  const hash = hashString(agent.id + agent.name)
  const x = bounds.x1 + (hash % (bounds.x2 - bounds.x1))
  const y = bounds.y1 + (Math.floor(hash / 100) % (bounds.y2 - bounds.y1))
  return { x: Math.abs(x), y: Math.abs(y) }
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

export function getAgentFrameIndex(agentIndex: number): number {
  return agentIndex % 8
}
