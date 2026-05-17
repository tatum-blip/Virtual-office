'use client'

interface RoomLabelProps {
  name: string
  screenX: number
  screenY: number
}

export function RoomLabel({ name, screenX, screenY }: RoomLabelProps) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: screenX, top: screenY, transform: 'translate(-50%, -100%)' }}
    >
      <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-md px-2 py-0.5 text-white/60 text-xs font-medium whitespace-nowrap">
        {name}
      </div>
    </div>
  )
}
