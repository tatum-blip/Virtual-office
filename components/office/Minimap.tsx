'use client'
import type { PresencePayload } from '@/types/presence'
import type { FloorId } from '@/game/scenes/OfficeScene'
import { AVATAR_COLORS } from '@/game/entities/PlayerAvatar'

const TILE = 32
const SCALE = 3

const MAP_W = 52 * SCALE  // 156px
const MAP_H = 30 * SCALE  // 90px

const MAIN_ROOMS = [
  { name: 'stairwell',      x: 0,  y: 2,  w: 4,  h: 25, fill: '#374151', stroke: '#4b5563' },
  { name: 'open_plan',      x: 4,  y: 2,  w: 18, h: 10, fill: '#fdf8ef', stroke: '#e2d9c8' },
  { name: 'breakout_1',     x: 4,  y: 13, w: 10, h: 9,  fill: '#d6f0e2', stroke: '#6dbf8a' },
  { name: 'center_meeting', x: 15, y: 13, w: 15, h: 9,  fill: '#c8e4f5', stroke: '#90bcd8' },
  { name: 'lounge',         x: 4,  y: 22, w: 26, h: 5,  fill: '#fde9d2', stroke: '#e0b88a' },
  { name: 'corner_office',  x: 32, y: 2,  w: 18, h: 16, fill: '#ede8de', stroke: '#c8c0b4' },
  { name: 'breakout_2',     x: 32, y: 19, w: 18, h: 8,  fill: '#e4daf8', stroke: '#9b72d0' },
]

const AGENT_ROOMS = [
  { name: 'stairwell',   x: 0,  y: 2,  w: 4,  h: 25, fill: '#111827', stroke: '#1f2937' },
  { name: 'agent_hub',   x: 4,  y: 2,  w: 26, h: 15, fill: '#0c1a30', stroke: '#22d3ee40' },
  { name: 'server_room', x: 4,  y: 17, w: 13, h: 10, fill: '#060c1a', stroke: '#22d3ee40' },
  { name: 'briefing',    x: 18, y: 17, w: 12, h: 10, fill: '#111c33', stroke: '#a78bfa40' },
  { name: 'neural_core', x: 32, y: 2,  w: 18, h: 25, fill: '#0a0f24', stroke: '#ec489940' },
]

interface MinimapProps {
  floor: FloorId
  presences: Record<string, PresencePayload>
  localUserId: string
  localX: number
  localY: number
  localRoomId: string | null
}

export function Minimap({ floor, presences, localUserId, localX, localY, localRoomId }: MinimapProps) {
  const rooms = floor === 'agent' ? AGENT_ROOMS : MAIN_ROOMS
  const isAgent = floor === 'agent'

  const mx = (wx: number) => (wx / TILE) * SCALE
  const my = (wy: number) => (wy / TILE) * SCALE

  // Count users per room (remote + local)
  const roomCounts: Record<string, number> = {}
  Object.values(presences).forEach((p) => {
    if (p.roomId) roomCounts[p.roomId] = (roomCounts[p.roomId] ?? 0) + 1
  })
  if (localRoomId) roomCounts[localRoomId] = (roomCounts[localRoomId] ?? 0) + 1

  return (
    <div className="absolute bottom-14 right-4 z-40 pointer-events-none">
      <div
        className="relative rounded-lg overflow-hidden shadow-2xl"
        style={{
          width: MAP_W,
          height: MAP_H,
          backgroundColor: isAgent ? '#030714' : '#0d1320',
          border: `1px solid ${isAgent ? 'rgba(34,211,238,0.18)' : 'rgba(255,255,255,0.08)'}`,
        }}
      >
        <svg width={MAP_W} height={MAP_H} className="absolute inset-0">
          {/* Room fills */}
          {rooms.map((r) => {
            const count = roomCounts[r.name] ?? 0
            const rx = r.x * SCALE, ry = r.y * SCALE
            const rw = r.w * SCALE, rh = r.h * SCALE
            return (
              <g key={r.name}>
                <rect x={rx} y={ry} width={rw} height={rh} fill={r.fill} stroke={r.stroke} strokeWidth={0.75} />
                {/* Room occupancy badge */}
                {count > 0 && (
                  <g>
                    <circle cx={rx + rw - 4} cy={ry + 4} r={4.5} fill={isAgent ? '#22d3ee' : '#6366f1'} opacity={0.9} />
                    <text x={rx + rw - 4} y={ry + 6.5} fontSize="4.5" fill="white" textAnchor="middle" fontWeight="bold">{count}</text>
                  </g>
                )}
              </g>
            )
          })}

          {/* Remote users */}
          {Object.values(presences).map((p) => {
            if (p.userId === localUserId) return null
            const color = AVATAR_COLORS[p.avatarIndex % AVATAR_COLORS.length]
            return (
              <circle key={p.userId} cx={mx(p.x)} cy={my(p.y)} r={3} fill={color} opacity={0.85} />
            )
          })}

          {/* Local player — white with cyan ring */}
          <circle cx={mx(localX)} cy={my(localY)} r={4.5} fill="rgba(255,255,255,0.18)" />
          <circle cx={mx(localX)} cy={my(localY)} r={3} fill="white" />
          <circle cx={mx(localX)} cy={my(localY)} r={3} fill="none" stroke="#22d3ee" strokeWidth={1} />
        </svg>

        {/* Floor badge */}
        <div
          className="absolute top-1 left-1.5 text-[7px] font-bold tracking-widest select-none"
          style={{ color: isAgent ? '#22d3ee' : '#94a3b8', opacity: 0.7 }}
        >
          {isAgent ? 'AGENT HUB' : 'MAIN FLOOR'}
        </div>
      </div>
    </div>
  )
}
