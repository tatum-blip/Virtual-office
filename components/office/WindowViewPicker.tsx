'use client'
import type { WindowView } from '@/game/scenes/OfficeScene'

interface WindowViewPickerProps {
  current: WindowView
  onSelect: (view: WindowView) => void
  onClose: () => void
}

interface ViewOption {
  id: WindowView
  label: string
  swatch: string  // CSS gradient that approximates the scene
  emoji: string
}

const VIEWS: ViewOption[] = [
  { id: 'city_day',     label: 'City — Day',       emoji: '🏙️', swatch: 'linear-gradient(180deg, #60a5fa 0%, #c6e5ff 60%, #475569 70%, #1e293b 100%)' },
  { id: 'city_night',   label: 'City — Night',     emoji: '🌃', swatch: 'linear-gradient(180deg, #0c1a3a 0%, #1e294f 60%, #111827 70%, #000 100%)' },
  { id: 'beach',        label: 'Beach Sunset',     emoji: '🏖️', swatch: 'linear-gradient(180deg, #fbbf24 0%, #fde088 50%, #0e7490 55%, #fde68a 85%)' },
  { id: 'mountains',    label: 'Mountains',        emoji: '🏔️', swatch: 'linear-gradient(180deg, #bfdbfe 0%, #f0f4f8 40%, #4b5563 60%, #166534 92%)' },
  { id: 'forest',       label: 'Forest',           emoji: '🌲', swatch: 'linear-gradient(180deg, #14532d 0%, #166534 40%, #22c55e 70%, #365314 100%)' },
]

export function WindowViewPicker({ current, onSelect, onClose }: WindowViewPickerProps) {
  return (
    <div className="absolute top-16 right-4 w-72 bg-[#0f0f1a]/95 backdrop-blur-md border border-amber-500/30 rounded-2xl shadow-2xl overflow-hidden z-40">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div>
          <h3 className="text-white text-sm font-semibold">Corner Office View</h3>
          <p className="text-white/40 text-xs mt-0.5">Visible to everyone</p>
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white text-lg leading-none">×</button>
      </div>
      <div className="p-2">
        {VIEWS.map((view) => {
          const active = view.id === current
          return (
            <button
              key={view.id}
              onClick={() => onSelect(view.id)}
              className={`w-full flex items-center gap-3 px-2 py-2 rounded-xl transition-all ${active ? 'bg-amber-500/15 border border-amber-500/30' : 'hover:bg-white/5 border border-transparent'}`}
            >
              <div
                className="w-12 h-12 rounded-lg border-2 border-amber-500/40 flex-shrink-0 flex items-end justify-center pb-0.5"
                style={{ background: view.swatch }}
              >
                <span className="text-sm opacity-70">{view.emoji}</span>
              </div>
              <div className="flex-1 text-left">
                <div className={`text-sm ${active ? 'text-amber-300' : 'text-white/80'}`}>{view.label}</div>
                {active && <div className="text-amber-400/60 text-xs">Currently displayed</div>}
              </div>
              {active && <span className="text-amber-400 text-xs">✓</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
