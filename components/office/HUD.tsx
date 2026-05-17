'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useDaily, useLocalParticipant } from '@daily-co/daily-react'
import { Avatar } from '@/components/ui/Avatar'
import type { Profile } from '@/types/database'
import type { FloorId } from '@/game/scenes/OfficeScene'

interface HUDProps {
  profile: Profile
  onlineCount: number
  localRoomId: string | null
  currentFloor: FloorId
  lockedRooms: Set<string>
  decorateMode: boolean
  agentRoamMain: boolean
  onSignOut: () => void
  onEditAvatar: () => void
  onLockRoom: (roomId: string, locked: boolean) => void
  onOpenWindowPicker: () => void
  onToggleDecorate: () => void
  onToggleAgentRoam: () => void
}

const LOCKABLE_MAIN_ROOMS = [
  { id: 'center_meeting', label: 'Meeting Room' },
  { id: 'corner_office',  label: 'Corner Office' },
  { id: 'breakout_1',     label: 'Breakout A'   },
  { id: 'breakout_2',     label: 'Breakout B'   },
]

const LOCKABLE_AGENT_ROOMS = [
  { id: 'neural_core',    label: 'Neural Core'  },
  { id: 'briefing_room',  label: 'Briefing'     },
  { id: 'server_room',    label: 'Server Room'  },
]

export function HUD({ profile, onlineCount, localRoomId, currentFloor, lockedRooms, decorateMode, agentRoamMain, onSignOut, onEditAvatar, onLockRoom, onOpenWindowPicker, onToggleDecorate, onToggleAgentRoam }: HUDProps) {
  const daily = useDaily()
  const localParticipant = useLocalParticipant()
  const [showLockMenu, setShowLockMenu] = useState(false)

  const cameraOn = localParticipant?.tracks?.video?.state === 'playable'
  const isCeo = profile.role === 'ceo'
  const lockableRooms = currentFloor === 'agent' ? LOCKABLE_AGENT_ROOMS : LOCKABLE_MAIN_ROOMS

  const toggleCamera = () => daily?.setLocalVideo(!cameraOn)

  return (
    <header className="h-14 bg-[#0f0f1a]/95 backdrop-blur-md border-b border-white/10 flex items-center px-5 gap-3 z-40 flex-shrink-0">

      {/* Logo */}
      <div className="flex items-center gap-2 mr-1">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-lg">
          A
        </div>
        <span className="text-white font-semibold text-sm hidden sm:block">Agency HQ</span>
      </div>

      {/* Floor indicator */}
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
        currentFloor === 'agent'
          ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      }`}>
        <span>{currentFloor === 'agent' ? '▼' : '▲'}</span>
        <span className="hidden sm:block">{currentFloor === 'agent' ? 'Agent Hub' : 'Main Floor'}</span>
      </div>

      {/* Online count */}
      <div className="flex items-center gap-1.5 text-sm text-white/50">
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span>{onlineCount} online</span>
      </div>

      {/* Room badge */}
      {localRoomId && (
        <div className="flex items-center gap-1.5 bg-violet-600/25 border border-violet-500/30 rounded-full px-3 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
          <span className="text-violet-300 text-xs font-medium">
            {localRoomId.replace(/_/g, ' ')}
          </span>
          {lockedRooms.has(localRoomId) && <span className="text-red-400 text-xs">🔒</span>}
        </div>
      )}

      <div className="flex-1" />

      {/* Window view picker — CEO only on main floor */}
      {isCeo && currentFloor === 'main' && (
        <button
          onClick={onOpenWindowPicker}
          title="Change corner office view"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-all"
        >
          <span>🌅</span>
          <span className="hidden md:block">View</span>
        </button>
      )}

      {/* Decorate toggle — visible for CEO or users with can_decorate */}
      {(isCeo || profile.can_decorate) && (
        <button
          onClick={onToggleDecorate}
          title={decorateMode ? 'Exit decorate mode' : 'Decorate the office'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
            decorateMode
              ? 'bg-violet-500/30 text-violet-200 border-violet-500/40'
              : 'bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/25'
          }`}
        >
          <span>🎨</span>
          <span className="hidden md:block">{decorateMode ? 'Exit Decorate' : 'Decorate'}</span>
        </button>
      )}

      {/* Camera toggle */}
      <button
        onClick={toggleCamera}
        title={cameraOn ? 'Turn camera off' : 'Turn camera on'}
        className={`w-9 h-9 rounded-xl flex items-center justify-center text-base transition-all ${
          cameraOn
            ? 'bg-white/10 text-white hover:bg-white/20'
            : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
        }`}
      >
        {cameraOn ? '📹' : '📵'}
      </button>

      {/* CEO lock/unlock panel */}
      {isCeo && (
        <div className="relative">
          <button
            onClick={() => setShowLockMenu((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              showLockMenu
                ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40'
                : 'bg-white/8 text-white/60 hover:bg-white/15 hover:text-white border border-white/10'
            }`}
          >
            <span>🔐</span>
            <span className="hidden sm:block">Lock Rooms</span>
          </button>

          {showLockMenu && (
            <div className="absolute right-0 top-11 w-60 bg-[#1a1f2e] border border-white/15 rounded-xl shadow-2xl overflow-hidden z-50">
              <div className="px-3 py-2 border-b border-white/10">
                <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Room Access</span>
              </div>
              {lockableRooms.map(({ id, label }) => {
                const isLocked = lockedRooms.has(id)
                return (
                  <button
                    key={id}
                    onClick={() => onLockRoom(id, !isLocked)}
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/8 transition-colors text-left"
                  >
                    <span className="text-white/80 text-sm">{label}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        isLocked
                          ? 'bg-red-500/25 text-red-400 border border-red-500/30'
                          : 'bg-green-500/20 text-green-400 border border-green-500/25'
                      }`}
                    >
                      {isLocked ? '🔒 Locked' : '🔓 Open'}
                    </span>
                  </button>
                )
              })}

              <div className="px-3 py-2 border-t border-b border-white/10">
                <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Agents</span>
              </div>
              <button
                onClick={onToggleAgentRoam}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/8 transition-colors text-left"
              >
                <span className="text-white/80 text-sm">Allow on main floor</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  agentRoamMain
                    ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/30'
                    : 'bg-white/10 text-white/50 border border-white/15'
                }`}>
                  {agentRoamMain ? 'On' : 'Off'}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Dashboard link */}
      {(profile.role === 'ceo' || profile.role === 'manager') && (
        <Link
          href="/dashboard"
          className="text-sm text-white/60 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10"
        >
          Dashboard
        </Link>
      )}

      {/* Avatar */}
      <button
        onClick={onEditAvatar}
        title="Customize avatar"
        className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-white/10 transition-colors"
      >
        <Avatar name={profile.display_name} index={profile.avatar_index} size={32} />
        <span className="text-white/80 text-sm hidden sm:block">{profile.display_name}</span>
      </button>

      <button
        onClick={onSignOut}
        className="text-white/40 hover:text-white/80 text-sm transition-colors"
      >
        Sign out
      </button>
    </header>
  )
}
