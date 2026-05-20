export interface PresencePayload {
  userId: string
  displayName: string
  x: number
  y: number
  roomId: string | null
  division: string | null
  avatarIndex: number
  avatarUrl?: string | null
  focus_mode?: boolean
  focus_task?: string
  focus_ends_at?: number | null
}

export interface RoomPresence {
  [userId: string]: PresencePayload
}
