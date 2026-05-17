'use client'
import { useEffect, useRef } from 'react'
import type { Emitter } from 'mitt'
import type { AgentDefinition } from '@/types/agent'
import type { OfficeEvents, FloorId, WindowView } from '@/game/scenes/OfficeScene'
import type { SupabaseClient } from '@supabase/supabase-js'

interface OfficeCanvasProps {
  userId: string
  displayName: string
  avatarIndex: number
  avatarUrl: string | null
  division: string | null
  agents: AgentDefinition[]
  supabase: SupabaseClient
  emitter: Emitter<OfficeEvents>
  floor: FloorId
  windowView: WindowView
  spawnAtStairwell?: boolean
  onReady?: () => void
}

export function OfficeCanvas({
  userId,
  displayName,
  avatarIndex,
  avatarUrl,
  division,
  agents,
  supabase,
  emitter,
  floor,
  windowView,
  spawnAtStairwell,
  onReady,
}: OfficeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<import('phaser').Game | null>(null)
  // Refs to avoid recreating when these change
  const agentsRef = useRef(agents)
  const windowViewRef = useRef(windowView)
  const avatarUrlRef = useRef(avatarUrl)
  useEffect(() => { agentsRef.current = agents }, [agents])
  useEffect(() => { windowViewRef.current = windowView }, [windowView])
  useEffect(() => { avatarUrlRef.current = avatarUrl }, [avatarUrl])

  // (Re)create the game whenever the floor changes
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      if (!containerRef.current) return
      // Tear down old game if any
      if (gameRef.current) {
        gameRef.current.destroy(true)
        gameRef.current = null
      }
      const { createGame } = await import('@/game/index')
      if (cancelled) return
      gameRef.current = await createGame('phaser-container', {
        userId,
        displayName,
        avatarIndex,
        avatarUrl: avatarUrlRef.current,
        division,
        agents: agentsRef.current,
        supabaseClient: supabase,
        emitter,
        floor,
        windowView: windowViewRef.current,
        spawnAtStairwell: !!spawnAtStairwell,
      })
      onReady?.()
    }
    init()
    return () => {
      cancelled = true
      if (gameRef.current) {
        gameRef.current.destroy(true)
        gameRef.current = null
      }
    }
    // Intentionally omit windowView from deps — handled via emitter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, displayName, avatarIndex, division, supabase, emitter, floor])

  return (
    <div
      id="phaser-container"
      ref={containerRef}
      className="w-full h-full"
      style={{ cursor: 'crosshair', boxShadow: 'inset 0 0 140px rgba(5, 8, 22, 0.72)' }}
    />
  )
}
