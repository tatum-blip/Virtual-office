import type { SupabaseClient } from '@supabase/supabase-js'

export type OfficeSettingKey = 'window_view' | 'agent_roam_main'

export interface OfficeSettingsMap {
  window_view?: string
  agent_roam_main?: string
}

/**
 * Fetch all office settings as a key→value map.
 * Returns an empty object if the table doesn't exist yet — caller should fall back to defaults.
 */
export async function fetchOfficeSettings(supabase: SupabaseClient): Promise<OfficeSettingsMap> {
  const { data, error } = await supabase.from('office_settings').select('key, value')
  if (error || !data) return {}
  const map: OfficeSettingsMap = {}
  for (const row of data as { key: string; value: string }[]) {
    map[row.key as OfficeSettingKey] = row.value
  }
  return map
}

export async function updateOfficeSetting(
  supabase: SupabaseClient,
  key: OfficeSettingKey,
  value: string,
  userId: string,
) {
  const { error } = await supabase.from('office_settings').upsert({
    key,
    value,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  })
  if (error) console.warn('[officeSettings] update failed:', error)
}

/**
 * Subscribe to realtime changes in the office_settings table.
 * Calls `onChange(key, value)` whenever any setting is updated.
 * Returns an unsubscribe function.
 */
export function subscribeToOfficeSettings(
  supabase: SupabaseClient,
  onChange: (key: string, value: string) => void,
): () => void {
  const channel = supabase
    .channel('office_settings_changes')
    .on(
      'postgres_changes' as never,
      { event: '*', schema: 'public', table: 'office_settings' },
      (payload: { new: { key?: string; value?: string } | null }) => {
        const next = payload.new
        if (next?.key && next?.value !== undefined) {
          onChange(next.key, next.value)
        }
      }
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
