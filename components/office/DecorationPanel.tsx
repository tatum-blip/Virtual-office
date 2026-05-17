'use client'
import { useState } from 'react'
import { DECORATION_CATALOG, type DecorationTypeMeta } from '@/lib/decorations'

interface DecorationPanelProps {
  onSelectType: (type: string) => void
  onClose: () => void
}

const CATEGORIES: Array<{ id: DecorationTypeMeta['category']; label: string; emoji: string }> = [
  { id: 'plants',  label: 'Plants',  emoji: '🌱' },
  { id: 'seating', label: 'Seating', emoji: '🛋️' },
  { id: 'decor',   label: 'Decor',   emoji: '🎨' },
  { id: 'gaming',  label: 'Gaming',  emoji: '🕹️' },
  { id: 'tech',    label: 'Tech',    emoji: '💻' },
]

export function DecorationPanel({ onSelectType, onClose }: DecorationPanelProps) {
  const [category, setCategory] = useState<DecorationTypeMeta['category']>('plants')
  const items = DECORATION_CATALOG.filter((i) => i.category === category)

  return (
    <div className="absolute bottom-4 left-4 w-80 bg-[#0f0f1a]/95 backdrop-blur-md border border-violet-500/30 rounded-2xl shadow-2xl overflow-hidden z-30">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div>
          <h3 className="text-white text-sm font-semibold flex items-center gap-1.5">
            <span>🎨</span> Decorate Mode
          </h3>
          <p className="text-white/40 text-xs mt-0.5">Click an item, then click on the floor to place</p>
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white text-lg leading-none px-2">×</button>
      </div>

      {/* Categories */}
      <div className="flex gap-1 px-3 py-2 border-b border-white/10 overflow-x-auto">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              category === c.id
                ? 'bg-violet-500/30 text-violet-200 border border-violet-500/40'
                : 'text-white/50 hover:text-white/80 hover:bg-white/5 border border-transparent'
            }`}
          >
            <span className="mr-1">{c.emoji}</span>
            {c.label}
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="grid grid-cols-3 gap-2 p-3 max-h-72 overflow-y-auto">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelectType(item.id)}
            title={item.label}
            className="flex flex-col items-center gap-1 p-2 rounded-xl bg-white/5 hover:bg-violet-500/15 border border-transparent hover:border-violet-500/30 transition-all"
          >
            <span className="text-2xl">{item.emoji}</span>
            <span className="text-white/70 text-[10px] text-center leading-tight">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-white/10 text-white/30 text-[10px]">
        Drag placed items to move · Right-click to delete
      </div>
    </div>
  )
}
