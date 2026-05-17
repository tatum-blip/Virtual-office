export interface AgentDefinition {
  id: string
  github_path: string
  name: string
  division: string
  description: string
  capabilities: string[]
  sprite_key: string
  color_hex: string
  raw_markdown: string
  status: 'idle' | 'working' | 'in_meeting'
  synced_at: string
}

export interface AgentTask {
  id: string
  agent_id: string
  assigned_by: string
  title: string
  description: string
  status: 'queued' | 'running' | 'done' | 'failed'
  log_output: string | null
  created_at: string
  updated_at: string
  agents?: { name: string; division: string; color_hex: string } | null
}
