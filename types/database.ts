export interface Profile {
  id: string
  display_name: string
  avatar_url: string | null
  role: 'employee' | 'manager' | 'ceo'
  division: string | null
  room_id: string | null
  is_online: boolean
  avatar_index: number
  can_decorate?: boolean
  created_at: string
}

export interface Room {
  id: string
  name: string
  type: 'personal' | 'meeting' | 'kitchen' | 'lounge' | 'open_plan'
  owner_id: string | null
  tile_x: number
  tile_y: number
  width: number
  height: number
  capacity: number
  created_at: string
}

export interface Permission {
  id: string
  user_id: string
  resource: string
  granted_by: string
  created_at: string
}
