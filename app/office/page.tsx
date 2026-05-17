'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import mitt from 'mitt'
import { DailyProvider, useDaily } from '@daily-co/daily-react'
import { createClient } from '@/lib/supabase'
import { getRoomUrl } from '@/lib/daily'
import { OfficeCanvas } from '@/components/office/OfficeCanvas'
import { VideoOverlay } from '@/components/office/VideoOverlay'
import { AgentPanel } from '@/components/office/AgentPanel'
import { HUD } from '@/components/office/HUD'
import { AvatarCustomizer } from '@/components/office/AvatarCustomizer'
import { WindowViewPicker } from '@/components/office/WindowViewPicker'
import { DecorationPanel } from '@/components/office/DecorationPanel'
import { fetchOfficeSettings, updateOfficeSetting, subscribeToOfficeSettings } from '@/lib/officeSettings'
import { fetchDecorations, addDecoration, moveDecoration, deleteDecoration, subscribeToDecorations } from '@/lib/decorations'
import type { Profile } from '@/types/database'
import type { AgentDefinition } from '@/types/agent'
import type { PresencePayload } from '@/types/presence'
import type { OfficeEvents, FloorId, WindowView } from '@/game/scenes/OfficeScene'

function OfficePageInner() {
  const router = useRouter()
  const supabase = createClient()
  const daily = useDaily()
  const emitterRef = useRef(mitt<OfficeEvents>())

  const [profile, setProfile] = useState<Profile | null>(null)
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [selectedAgent, setSelectedAgent] = useState<AgentDefinition | null>(null)
  const [presences, setPresences] = useState<Record<string, PresencePayload>>({})
  const [cameraState, setCameraState] = useState({ scrollX: 0, scrollY: 0, zoom: 1 })
  const [localRoomId, setLocalRoomId] = useState<string | null>(null)
  const [showAvatarCustomizer, setShowAvatarCustomizer] = useState(false)
  const [loading, setLoading] = useState(true)
  const [lockedRooms, setLockedRooms] = useState<Set<string>>(new Set())
  const [currentFloor, setCurrentFloor] = useState<FloorId>('main')
  const [spawnAtStairwell, setSpawnAtStairwell] = useState(false)
  const [fadeOpacity, setFadeOpacity] = useState(0)
  const [windowView, setWindowView] = useState<WindowView>('city_day')
  const [showWindowPicker, setShowWindowPicker] = useState(false)
  const [proximities, setProximities] = useState<{ userId: string; distance: number; inAudioZone: boolean }[]>([])
  const [decorateMode, setDecorateMode] = useState(false)
  const [showDecorationPanel, setShowDecorationPanel] = useState(false)
  const [selectedDecorationType, setSelectedDecorationType] = useState<string | null>(null)
  const [agentRoamMain, setAgentRoamMain] = useState(false)
  const [sceneReady, setSceneReady] = useState(false)

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (!profileData) {
        const { data: newProfile } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            display_name: user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'New User',
            role: 'employee',
            avatar_index: Math.floor(Math.random() * 8),
            is_online: true,
          })
          .select()
          .single()
        setProfile(newProfile as Profile)
      } else {
        setProfile(profileData as Profile)
        await supabase.from('profiles').update({ is_online: true }).eq('id', user.id)
      }

      const { data: agentData } = await supabase
        .from('agents')
        .select('*')
        .order('division')

      setAgents((agentData as AgentDefinition[]) ?? [])

      // Load office settings (window view, agent permissions, etc)
      const settings = await fetchOfficeSettings(supabase)
      if (settings.window_view) setWindowView(settings.window_view as WindowView)
      if (settings.agent_roam_main) setAgentRoamMain(settings.agent_roam_main === 'true')

      setLoading(false)
    }

    init()
  }, [])

  // Realtime sync of office settings (window view changes from other users)
  useEffect(() => {
    if (!profile) return
    const unsubscribe = subscribeToOfficeSettings(supabase, (key, value) => {
      if (key === 'window_view') {
        setWindowView(value as WindowView)
        emitterRef.current.emit('windowViewChange', value as WindowView)
      } else if (key === 'agent_roam_main') {
        setAgentRoamMain(value === 'true')
      }
    })
    return unsubscribe
  }, [supabase, profile])

  const handleToggleAgentRoam = useCallback(async () => {
    if (!profile) return
    const next = !agentRoamMain
    setAgentRoamMain(next)
    await updateOfficeSetting(supabase, 'agent_roam_main', String(next), profile.id)
  }, [agentRoamMain, profile, supabase])

  // Reset sceneReady when floor switches — new scene needs to signal ready again
  useEffect(() => {
    setSceneReady(false)
  }, [currentFloor])

  // Decorations: load + realtime sync per floor — wait until scene is ready so
  // applyDecorations isn't emitted before DecorationSystem registers its listener
  useEffect(() => {
    if (!profile) return
    if (!sceneReady) return
    let cancelled = false
    const reload = async () => {
      const items = await fetchDecorations(supabase, currentFloor)
      if (!cancelled) emitterRef.current.emit('applyDecorations', items)
    }
    reload()
    const unsub = subscribeToDecorations(supabase, currentFloor, reload)
    return () => { cancelled = true; unsub() }
  }, [supabase, profile, currentFloor, sceneReady])

  // Decoration: handle Phaser-side requests (place, move, delete)
  useEffect(() => {
    if (!profile) return
    const emitter = emitterRef.current
    const onPlace = async ({ type, x, y }: { type: string; x: number; y: number }) => {
      await addDecoration(supabase, currentFloor, type, x, y, profile.id)
      // Realtime sub will re-broadcast applyDecorations; no manual refetch needed
    }
    const onMove = async ({ id, x, y }: { id: string; x: number; y: number }) => {
      await moveDecoration(supabase, id, x, y)
    }
    const onRemove = async ({ id }: { id: string }) => {
      await deleteDecoration(supabase, id)
    }
    emitter.on('decorationPlaceRequest', onPlace)
    emitter.on('decorationMoveRequest', onMove)
    emitter.on('decorationRemoveRequest', onRemove)
    return () => {
      emitter.off('decorationPlaceRequest', onPlace)
      emitter.off('decorationMoveRequest', onMove)
      emitter.off('decorationRemoveRequest', onRemove)
    }
  }, [profile, supabase, currentFloor])

  // Push decorate-mode + selected type to Phaser (also re-push when scene becomes ready
  // so the new scene after a floor transition picks up current state)
  useEffect(() => {
    if (!sceneReady) return
    emitterRef.current.emit('setDecorateMode', decorateMode)
  }, [decorateMode, sceneReady])

  useEffect(() => {
    if (!sceneReady) return
    emitterRef.current.emit('selectDecorationType', selectedDecorationType)
  }, [selectedDecorationType, sceneReady])

  useEffect(() => {
    const emitter = emitterRef.current
    emitter.on('agentClick', setSelectedAgent)
    emitter.on('presenceUpdate', setPresences)
    emitter.on('positionUpdate', ({ scrollX, scrollY, zoom }) => {
      setCameraState({ scrollX, scrollY, zoom })
    })
    emitter.on('doorLocked', ({ roomId, locked }) => {
      setLockedRooms((prev) => {
        const next = new Set(prev)
        if (locked) next.add(roomId)
        else next.delete(roomId)
        return next
      })
    })
    emitter.on('roomChange', setLocalRoomId)
    emitter.on('proximityUpdate', setProximities)
    emitter.on('sceneReady', () => setSceneReady(true))
    return () => emitter.all.clear()
  }, [])

  // Handle floor transitions with fade overlay
  useEffect(() => {
    const emitter = emitterRef.current
    const handleTransition = (toFloor: FloorId) => {
      setFadeOpacity(1)
      setTimeout(() => {
        setSpawnAtStairwell(true)
        setCurrentFloor(toFloor)
        setLocalRoomId(null)
        setPresences({})
        setProximities([])
      }, 400)
      setTimeout(() => setFadeOpacity(0), 1100)
    }
    emitter.on('floorTransition', handleTransition)
    return () => emitter.off('floorTransition', handleTransition)
  }, [])

  // Join Daily.co once per floor (Kumospace-style: everyone on the floor is in the same call)
  useEffect(() => {
    if (!daily || !profile) return
    let cancelled = false
    const floorCallId = `floor_${currentFloor}`
    const join = async () => {
      try {
        await daily.leave().catch(() => null)
        if (cancelled) return
        await daily.join({ url: getRoomUrl(floorCallId), userName: profile.id })
      } catch (err) {
        console.warn('[Daily] floor join failed:', err)
      }
    }
    join()
    return () => { cancelled = true }
  }, [daily, profile, currentFloor])

  const handleLockRoom = (roomId: string, locked: boolean) => {
    emitterRef.current.emit('lockRoom', { roomId, locked })
  }

  const handleSaveAvatar = async (avatarIndex: number) => {
    if (!profile) return
    await supabase.from('profiles').update({ avatar_index: avatarIndex }).eq('id', profile.id)
    setProfile((p) => p ? { ...p, avatar_index: avatarIndex } : p)
  }

  const handleUploadPhoto = async (file: File): Promise<string | null> => {
    if (!profile) return null
    const ext = file.name.split('.').pop() || 'png'
    const path = `${profile.id}/avatar.${ext}`
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, cacheControl: '0' })
    if (upErr) { console.warn('[avatar upload]', upErr); return null }
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
    const url = `${pub.publicUrl}?t=${Date.now()}`
    await supabase.from('profiles').update({ avatar_url: url }).eq('id', profile.id)
    setProfile((p) => p ? { ...p, avatar_url: url } : p)
    return url
  }

  const handleRemovePhoto = async () => {
    if (!profile) return
    await supabase.from('profiles').update({ avatar_url: null }).eq('id', profile.id)
    setProfile((p) => p ? { ...p, avatar_url: null } : p)
  }

  const handleChangeWindowView = useCallback(async (view: WindowView) => {
    if (!profile) return
    setWindowView(view)
    emitterRef.current.emit('windowViewChange', view)
    await updateOfficeSetting(supabase, 'window_view', view, profile.id)
  }, [profile, supabase])

  const handleSignOut = async () => {
    if (profile) {
      await supabase.from('profiles').update({ is_online: false }).eq('id', profile.id)
    }
    await daily?.leave().catch(() => null)
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 mx-auto mb-4 animate-pulse" />
          <p className="text-white/40 text-sm">Loading office…</p>
        </div>
      </div>
    )
  }

  const onlineCount = Object.keys(presences).length + 1
  const isCeo = profile.role === 'ceo'

  return (
    <div className="flex flex-col h-screen bg-[#0f0f1a] overflow-hidden">
      <HUD
        profile={profile}
        onlineCount={onlineCount}
        localRoomId={localRoomId}
        currentFloor={currentFloor}
        lockedRooms={lockedRooms}
        decorateMode={decorateMode}
        agentRoamMain={agentRoamMain}
        onSignOut={handleSignOut}
        onEditAvatar={() => setShowAvatarCustomizer(true)}
        onLockRoom={handleLockRoom}
        onOpenWindowPicker={() => setShowWindowPicker((v) => !v)}
        onToggleDecorate={() => {
          const next = !decorateMode
          setDecorateMode(next)
          setShowDecorationPanel(next)
          if (!next) setSelectedDecorationType(null)
        }}
        onToggleAgentRoam={handleToggleAgentRoam}
      />

      <div className="relative flex-1 overflow-hidden">
        <OfficeCanvas
          userId={profile.id}
          displayName={profile.display_name}
          avatarIndex={profile.avatar_index}
          avatarUrl={profile.avatar_url ?? null}
          division={profile.division}
          agents={agents}
          supabase={supabase}
          emitter={emitterRef.current}
          floor={currentFloor}
          windowView={windowView}
          spawnAtStairwell={spawnAtStairwell}
        />

        <VideoOverlay
          presences={presences}
          proximities={proximities}
          localUserId={profile.id}
          cameraState={cameraState}
        />

        <AgentPanel
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />

        {/* CEO window view picker */}
        {isCeo && showWindowPicker && currentFloor === 'main' && (
          <WindowViewPicker
            current={windowView}
            onSelect={(v) => { handleChangeWindowView(v); setShowWindowPicker(false) }}
            onClose={() => setShowWindowPicker(false)}
          />
        )}

        {/* Decoration palette panel */}
        {showDecorationPanel && (isCeo || profile.can_decorate) && (
          <DecorationPanel
            onSelectType={(t) => setSelectedDecorationType(t)}
            onClose={() => {
              setShowDecorationPanel(false)
              setDecorateMode(false)
              setSelectedDecorationType(null)
            }}
          />
        )}

        {/* Placement type indicator */}
        {decorateMode && selectedDecorationType && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-violet-500/90 text-white text-xs font-medium px-3 py-1.5 rounded-full pointer-events-none shadow-lg">
            Click to place · Right-click to cancel
          </div>
        )}

        {/* Fade overlay for floor transitions */}
        <div
          className="absolute inset-0 bg-black pointer-events-none transition-opacity duration-500"
          style={{ opacity: fadeOpacity }}
        >
          {fadeOpacity > 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-white/60 text-sm tracking-widest animate-pulse">
                {currentFloor === 'main' ? '↓ Descending to Agent Hub' : '↑ Returning to Main Floor'}
              </div>
            </div>
          )}
        </div>

        {agents.length === 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm border border-white/10 rounded-full px-4 py-2 text-white/50 text-xs">
            No agents yet — go to Dashboard and click &quot;Sync Agents&quot;
          </div>
        )}

        <div className="absolute bottom-4 right-4 bg-black/40 backdrop-blur-sm border border-white/10 rounded-full px-3 py-1.5 text-white/30 text-xs pointer-events-none">
          Click to move · WASD · Walk into stairwell to switch floors
        </div>
      </div>

      {showAvatarCustomizer && (
        <AvatarCustomizer
          displayName={profile.display_name}
          currentIndex={profile.avatar_index}
          currentAvatarUrl={profile.avatar_url ?? null}
          onClose={() => setShowAvatarCustomizer(false)}
          onSave={handleSaveAvatar}
          onUploadPhoto={handleUploadPhoto}
          onRemovePhoto={handleRemovePhoto}
        />
      )}
    </div>
  )
}

export default function OfficePage() {
  return (
    <DailyProvider>
      <OfficePageInner />
    </DailyProvider>
  )
}
