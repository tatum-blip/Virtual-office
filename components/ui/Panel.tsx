'use client'
import { type ReactNode } from 'react'

interface PanelProps {
  children: ReactNode
  className?: string
}

export function Panel({ children, className = '' }: PanelProps) {
  return (
    <div
      className={`bg-white/10 backdrop-blur-md border border-white/20 rounded-xl shadow-2xl ${className}`}
    >
      {children}
    </div>
  )
}
