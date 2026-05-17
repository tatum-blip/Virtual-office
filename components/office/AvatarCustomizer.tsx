'use client'
import { useState, useEffect, useRef } from 'react'
import { Panel } from '@/components/ui/Panel'

type Mode = 'creature' | 'photo'

// Must stay in sync with game/entities/PlayerAvatar.ts AVATAR_COLORS
const AVATAR_COLORS = [
  '#F97316', '#14B8A6', '#6366F1', '#EC4899',
  '#8B5CF6', '#EAB308', '#22C55E', '#06B6D4',
]

const COLOR_NAMES = [
  'Sunset', 'Teal', 'Indigo', 'Pink',
  'Violet', 'Gold', 'Emerald', 'Cyan',
]

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

function lighten({ r, g, b }: { r: number; g: number; b: number }, amt = 60) {
  return {
    r: Math.min(255, r + amt),
    g: Math.min(255, g + amt),
    b: Math.min(255, b + amt),
  }
}

function rgb(c: { r: number; g: number; b: number }, a = 1) {
  return `rgba(${c.r},${c.g},${c.b},${a})`
}

function drawCreaturePreview(canvas: HTMLCanvasElement, colorHex: string) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const S = canvas.width
  const cx = S / 2, cy = S / 2
  const r = S * 0.28
  ctx.clearRect(0, 0, S, S)

  const col = hexToRgb(colorHex)
  const light = lighten(col, 50)

  // drop shadow
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx + 1, cy + r + 7, r * 0.9, r * 0.32, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fill()
  ctx.restore()

  // body
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = rgb(col)
  ctx.fill()

  // shine
  ctx.beginPath()
  ctx.arc(cx - r * 0.3, cy - r * 0.38, r * 0.38, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  ctx.fill()

  // outline
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = rgb(light, 0.9)
  ctx.lineWidth = 1.5
  ctx.stroke()

  // ears
  for (const ex of [cx - r * 0.54, cx + r * 0.54]) {
    ctx.beginPath()
    ctx.arc(ex, cy - r * 0.84, r * 0.3, 0, Math.PI * 2)
    ctx.fillStyle = rgb(col)
    ctx.fill()
    ctx.strokeStyle = rgb(light, 0.7)
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // eyes
  for (const [ex, ey] of [[cx - r * 0.3, cy - r * 0.15] as const, [cx + r * 0.3, cy - r * 0.15] as const]) {
    ctx.beginPath()
    ctx.arc(ex, ey, r * 0.28, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()

    ctx.beginPath()
    ctx.arc(ex + r * 0.05, ey + r * 0.05, r * 0.16, 0, Math.PI * 2)
    ctx.fillStyle = '#1a1a2e'
    ctx.fill()

    ctx.beginPath()
    ctx.arc(ex, ey - r * 0.04, r * 0.06, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }

  // smile
  ctx.beginPath()
  ctx.arc(cx, cy + r * 0.28, r * 0.36, 0.2, Math.PI - 0.2, false)
  ctx.strokeStyle = '#1a1a2e'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // crown
  const crownY = cy - r - S * 0.12
  const crownW = S * 0.28
  const crownX = cx - crownW / 2
  ctx.fillStyle = '#ffd700'
  ctx.fillRect(crownX, crownY + S * 0.055, crownW, S * 0.036)
  ctx.beginPath()
  ctx.moveTo(crownX, crownY + S * 0.055)
  ctx.lineTo(crownX + crownW * 0.15, crownY)
  ctx.lineTo(crownX + crownW * 0.3, crownY + S * 0.055)
  ctx.lineTo(crownX + crownW * 0.5, crownY - S * 0.024)
  ctx.lineTo(crownX + crownW * 0.7, crownY + S * 0.055)
  ctx.lineTo(crownX + crownW * 0.85, crownY)
  ctx.lineTo(crownX + crownW, crownY + S * 0.055)
  ctx.fillStyle = '#ffd700'
  ctx.fill()
}

function CreatureCanvas({ colorHex, size = 96 }: { colorHex: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (ref.current) drawCreaturePreview(ref.current, colorHex)
  }, [colorHex])

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated' }}
    />
  )
}

interface AvatarCustomizerProps {
  displayName: string
  currentIndex: number
  currentAvatarUrl: string | null
  onClose: () => void
  onSave: (avatarIndex: number) => Promise<void>
  onUploadPhoto: (file: File) => Promise<string | null>
  onRemovePhoto: () => Promise<void>
}

export function AvatarCustomizer({ displayName, currentIndex, currentAvatarUrl, onClose, onSave, onUploadPhoto, onRemovePhoto }: AvatarCustomizerProps) {
  const [selected, setSelected] = useState(currentIndex)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<Mode>(currentAvatarUrl ? 'photo' : 'creature')
  const [photoUrl, setPhotoUrl] = useState<string | null>(currentAvatarUrl)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(selected)
      if (mode === 'creature' && currentAvatarUrl) {
        await onRemovePhoto()
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await onUploadPhoto(file)
      if (url) {
        setPhotoUrl(url)
        setMode('photo')
      }
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = async () => {
    setUploading(true)
    try {
      await onRemovePhoto()
      setPhotoUrl(null)
      setMode('creature')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <Panel className="w-full max-w-sm p-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-white font-bold text-lg">Customize Avatar</h2>
            <p className="text-white/40 text-sm mt-0.5">Photo or creature — Kumospace style</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl leading-none">
            ✕
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 p-1 bg-white/5 rounded-xl mb-5">
          <button
            onClick={() => setMode('photo')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === 'photo' ? 'bg-violet-600 text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            📷 Photo
          </button>
          <button
            onClick={() => setMode('creature')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === 'creature' ? 'bg-violet-600 text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            🐾 Creature
          </button>
        </div>

        {/* Preview */}
        <div className="flex flex-col items-center gap-2 mb-6">
          {mode === 'photo' && photoUrl ? (
            <div className="w-24 h-24 rounded-full border-4 overflow-hidden shadow-xl"
              style={{ borderColor: AVATAR_COLORS[selected] }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl} alt="" className="w-full h-full object-cover" />
            </div>
          ) : mode === 'photo' ? (
            <div className="w-24 h-24 rounded-full border-4 border-dashed border-white/20 flex items-center justify-center text-white/30 text-xs">
              No photo yet
            </div>
          ) : (
            <CreatureCanvas colorHex={AVATAR_COLORS[selected]} size={96} />
          )}
          <span className="text-white font-medium text-sm">{displayName}</span>
          {mode === 'creature' && <span className="text-white/40 text-xs">{COLOR_NAMES[selected]}</span>}
        </div>

        {/* Photo mode UI */}
        {mode === 'photo' && (
          <div className="mb-5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex-1 py-2.5 rounded-xl bg-white/8 hover:bg-white/15 text-white text-sm border border-white/15 transition-colors disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : photoUrl ? 'Replace Photo' : 'Upload Photo'}
              </button>
              {photoUrl && (
                <button
                  onClick={handleRemove}
                  disabled={uploading}
                  className="px-4 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-300 text-sm border border-red-500/30 transition-colors disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-white/30 text-xs mt-2 text-center">Border color picked from creature palette below</p>
          </div>
        )}

        {/* Color grid (always visible — used as border color too) */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {AVATAR_COLORS.map((color, i) => (
            <button
              key={i}
              onClick={() => setSelected(i)}
              title={COLOR_NAMES[i]}
              className={`relative w-full aspect-square rounded-2xl transition-all duration-150 ${
                selected === i
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1a1a2e] scale-110'
                  : 'opacity-60 hover:opacity-90 hover:scale-105'
              }`}
              style={{ backgroundColor: color }}
            >
              {selected === i && (
                <span className="absolute inset-0 flex items-center justify-center text-white text-lg drop-shadow">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/20 text-white/60 hover:text-white text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || uploading}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Panel>
    </div>
  )
}
