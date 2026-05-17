'use client'

const AVATAR_COLORS = [
  '#F97316', '#14B8A6', '#6366F1', '#EC4899',
  '#8B5CF6', '#EAB308', '#22C55E', '#06B6D4',
]

interface AvatarProps {
  name: string
  index: number
  size?: number
  className?: string
}

export function Avatar({ name, index, size = 40, className = '' }: AvatarProps) {
  const color = AVATAR_COLORS[index % AVATAR_COLORS.length]
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div
      className={`flex items-center justify-center rounded-full font-bold text-white ${className}`}
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  )
}
