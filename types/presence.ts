export interface PresencePayload {
  userId: string
  displayName: string
  x: number
  y: number
  roomId: string | null
  division: string | null
  avatarIndex: number
  avatarUrl?: string | null
}

export interface RoomPresence {
  [userId: string]: PresencePayload
}
