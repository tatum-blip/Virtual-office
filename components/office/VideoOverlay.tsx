'use client'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useDaily, useParticipantIds, useVideoTrack, useAudioTrack, DailyVideo } from '@daily-co/daily-react'
import { Avatar } from '@/components/ui/Avatar'
import type { PresencePayload } from '@/types/presence'

interface CameraState {
  scrollX: number
  scrollY: number
  zoom: number
}

interface ProximityEntry {
  userId: string
  distance: number
  inAudioZone: boolean
}

interface VideoOverlayProps {
  presences: Record<string, PresencePayload>
  proximities: ProximityEntry[]
  localUserId: string
  cameraState: CameraState
}

const AVATAR_COLORS = [
  '#F97316', '#14B8A6', '#6366F1', '#EC4899',
  '#8B5CF6', '#EAB308', '#22C55E', '#06B6D4',
]

// Kumospace-style: bubbles appear within radius, fade with distance
const PROXIMITY_RADIUS = 220
const GRACE_PERIOD_MS = 1500

function worldToScreen(worldX: number, worldY: number, cam: CameraState) {
  return {
    x: (worldX - cam.scrollX) * cam.zoom,
    y: (worldY - cam.scrollY) * cam.zoom,
  }
}

function useParticipantByUserId(): Record<string, string> {
  const daily = useDaily()
  const participantIds = useParticipantIds()

  return useMemo(() => {
    if (!daily) return {}
    const participants = daily.participants()
    const map: Record<string, string> = {}
    for (const p of Object.values(participants)) {
      if (p.user_name) map[p.user_name] = p.session_id
    }
    return map
  }, [participantIds, daily])
}

interface TileProps {
  payload: PresencePayload
  screenX: number
  screenY: number
  sessionId: string | undefined
  opacity: number
  scale: number
  inAudioZone: boolean
  volume: number
}

function VideoTile({ payload, screenX, screenY, sessionId, opacity, scale, inAudioZone, volume }: TileProps) {
  const videoTrack = useVideoTrack(sessionId ?? '')
  const audioTrack = useAudioTrack(sessionId ?? '')
  const cameraOn = !!sessionId && videoTrack.state === 'playable'
  const color = AVATAR_COLORS[payload.avatarIndex % AVATAR_COLORS.length]
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Adjust per-participant audio volume based on distance
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, volume))
  }, [volume])

  // Mount remote audio if we have a track
  const hasAudio = !!sessionId && audioTrack.state === 'playable' && audioTrack.persistentTrack
  useEffect(() => {
    if (audioRef.current && audioTrack.persistentTrack) {
      const ms = new MediaStream([audioTrack.persistentTrack])
      audioRef.current.srcObject = ms
    }
  }, [audioTrack.persistentTrack])

  const baseSize = 90
  const size = baseSize * scale

  return (
    <div
      className="absolute pointer-events-none transition-opacity duration-300 ease-out"
      style={{
        left: screenX,
        top: screenY,
        transform: 'translate(-50%, -100%)',
        opacity,
      }}
    >
      <div
        className="rounded-full border-[3px] overflow-hidden flex items-center justify-center shadow-2xl"
        style={{
          width: size,
          height: size,
          borderColor: inAudioZone ? '#fbbf24' : color,
          backgroundColor: color + '22',
          boxShadow: inAudioZone
            ? `0 0 24px ${color}88, 0 0 12px #fbbf24aa`
            : `0 0 16px ${color}66`,
        }}
      >
        {cameraOn ? (
          <DailyVideo
            sessionId={sessionId!}
            type="video"
            className="w-full h-full object-cover"
          />
        ) : (
          <Avatar name={payload.displayName} index={payload.avatarIndex} size={size - 6} />
        )}
      </div>
      <div className="mt-1 text-center text-white/90 text-xs font-medium bg-black/60 rounded px-1.5 py-0.5 whitespace-nowrap max-w-[6.5rem] truncate mx-auto">
        {payload.displayName}
      </div>
      {hasAudio && <audio ref={audioRef} autoPlay playsInline />}
    </div>
  )
}

export function VideoOverlay({
  presences,
  proximities,
  localUserId,
  cameraState,
}: VideoOverlayProps) {
  const userToSession = useParticipantByUserId()
  const frameRef = useRef<number>(0)
  const lastSeenRef = useRef<Record<string, number>>({})
  const [tiles, setTiles] = useState<Array<{
    payload: PresencePayload
    screenX: number
    screenY: number
    opacity: number
    scale: number
    inAudioZone: boolean
    volume: number
  }>>([])

  const compute = useCallback(() => {
    const now = Date.now()
    const proxByUser = new Map<string, ProximityEntry>()
    for (const p of proximities) proxByUser.set(p.userId, p)

    const next: typeof tiles = []
    for (const payload of Object.values(presences)) {
      if (payload.userId === localUserId) continue

      const prox = proxByUser.get(payload.userId)
      // If user is currently within range or audio zone, refresh last-seen
      if (prox) {
        lastSeenRef.current[payload.userId] = now
      }
      const lastSeen = lastSeenRef.current[payload.userId] ?? 0
      const sinceLastSeen = now - lastSeen
      if (!prox && sinceLastSeen > GRACE_PERIOD_MS) continue

      const distance = prox?.distance ?? PROXIMITY_RADIUS
      const inAudioZone = !!prox?.inAudioZone

      // Opacity/scale fall off with distance, but full if in shared audio zone
      const closeness = Math.max(0, 1 - distance / PROXIMITY_RADIUS)
      const opacity = inAudioZone ? 1 : Math.max(0.25, closeness)
      const scale = inAudioZone ? 1 : 0.55 + closeness * 0.45
      const volume = inAudioZone ? 1 : closeness

      const { x, y } = worldToScreen(payload.x, payload.y, cameraState)
      next.push({
        payload,
        screenX: x,
        screenY: y - 30,
        opacity,
        scale,
        inAudioZone,
        volume,
      })
    }
    setTiles(next)
  }, [presences, localUserId, cameraState, proximities])

  useEffect(() => {
    frameRef.current = requestAnimationFrame(compute)
    return () => cancelAnimationFrame(frameRef.current)
  }, [compute])

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {tiles.map(({ payload, screenX, screenY, opacity, scale, inAudioZone, volume }) => (
        <VideoTile
          key={payload.userId}
          payload={payload}
          screenX={screenX}
          screenY={screenY}
          sessionId={userToSession[payload.userId]}
          opacity={opacity}
          scale={scale}
          inAudioZone={inAudioZone}
          volume={volume}
        />
      ))}
    </div>
  )
}
