import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { DashboardClient } from './DashboardClient'
import type { AgentDefinition } from '@/types/agent'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: permission } = await supabase
    .from('permissions')
    .select('id')
    .eq('user_id', user.id)
    .eq('resource', 'agent_dashboard')
    .single()

  const canAccess = profile?.role === 'ceo' || profile?.role === 'manager' || !!permission

  if (!canAccess) redirect('/office')

  const { data: agents } = await supabase.from('agents').select('*').order('division')
  const { data: allProfiles } = await supabase.from('profiles').select('id, display_name, role, division, is_online')

  return (
    <DashboardClient
      agents={(agents as AgentDefinition[]) ?? []}
      profiles={allProfiles ?? []}
      isCeo={profile?.role === 'ceo'}
      canSync={profile?.role === 'ceo' || profile?.role === 'manager'}
    />
  )
}
