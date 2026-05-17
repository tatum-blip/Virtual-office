import type { SupabaseClient } from '@supabase/supabase-js'
import type { DecorationItem, FloorId } from '@/game/scenes/OfficeScene'

export async function fetchDecorations(supabase: SupabaseClient, floor: FloorId): Promise<DecorationItem[]> {
  const { data, error } = await supabase
    .from('floor_decorations')
    .select('id, floor, type, x, y, rotation')
    .eq('floor', floor)
  if (error || !data) {
    if (error) console.warn('[decorations] fetch failed:', error.message)
    return []
  }
  return data as DecorationItem[]
}

export async function addDecoration(
  supabase: SupabaseClient,
  floor: FloorId,
  type: string,
  x: number,
  y: number,
  placedBy: string,
): Promise<DecorationItem | null> {
  const { data, error } = await supabase
    .from('floor_decorations')
    .insert({ floor, type, x, y, rotation: 0, placed_by: placedBy })
    .select()
    .single()
  if (error || !data) { console.warn('[decorations] add failed:', error?.message); return null }
  return data as DecorationItem
}

export async function moveDecoration(
  supabase: SupabaseClient,
  id: string,
  x: number,
  y: number,
) {
  const { error } = await supabase
    .from('floor_decorations')
    .update({ x, y })
    .eq('id', id)
  if (error) console.warn('[decorations] move failed:', error.message)
}

export async function deleteDecoration(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('floor_decorations').delete().eq('id', id)
  if (error) console.warn('[decorations] delete failed:', error.message)
}

export function subscribeToDecorations(
  supabase: SupabaseClient,
  floor: FloorId,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`decorations_${floor}`)
    .on(
      'postgres_changes' as never,
      { event: '*', schema: 'public', table: 'floor_decorations', filter: `floor=eq.${floor}` },
      () => onChange()
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

export interface DecorationTypeMeta {
  id: string
  label: string
  category: 'plants' | 'seating' | 'decor' | 'gaming' | 'tech'
  emoji: string
}

export const DECORATION_CATALOG: DecorationTypeMeta[] = [
  { id: 'plant_sm',    label: 'Small Plant',  category: 'plants', emoji: '🌱' },
  { id: 'plant_lg',    label: 'Large Plant',  category: 'plants', emoji: '🪴' },
  { id: 'plant_cactus',label: 'Cactus',       category: 'plants', emoji: '🌵' },
  { id: 'sofa',        label: 'Sofa',         category: 'seating', emoji: '🛋️' },
  { id: 'chair_lounge',label: 'Lounge Chair', category: 'seating', emoji: '🪑' },
  { id: 'bean_bag',    label: 'Bean Bag',     category: 'seating', emoji: '🟣' },
  { id: 'rug_blue',    label: 'Blue Rug',     category: 'decor',  emoji: '🟦' },
  { id: 'rug_red',     label: 'Red Rug',      category: 'decor',  emoji: '🟥' },
  { id: 'poster',      label: 'Wall Poster',  category: 'decor',  emoji: '🖼️' },
  { id: 'lamp',        label: 'Floor Lamp',   category: 'decor',  emoji: '💡' },
  { id: 'arcade',      label: 'Arcade',       category: 'gaming', emoji: '🕹️' },
  { id: 'whiteboard',  label: 'Whiteboard',   category: 'tech',   emoji: '📋' },
  { id: 'monitor',     label: 'Extra Monitor',category: 'tech',   emoji: '🖥️' },
]
