import type { RealtimeChannel } from '@supabase/supabase-js'
import type { PresencePayload } from '@/types/presence'

type PresenceHandler = (presences: Record<string, PresencePayload>) => void

export class PresenceSystem {
  private channel: RealtimeChannel
  private broadcastInterval: ReturnType<typeof setInterval> | null = null
  private currentPayload: PresencePayload | null = null
  private onUpdate: PresenceHandler

  constructor(channel: RealtimeChannel, onUpdate: PresenceHandler) {
    this.channel = channel
    this.onUpdate = onUpdate
  }

  start(initialPayload: PresencePayload) {
    this.currentPayload = initialPayload

    this.channel
      .on('presence', { event: 'sync' }, () => {
        const state = this.channel.presenceState<PresencePayload>()
        const flat: Record<string, PresencePayload> = {}
        for (const [key, presences] of Object.entries(state)) {
          if (presences.length > 0) flat[key] = presences[0]
        }
        this.onUpdate(flat)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.channel.track(initialPayload)
        }
      })

    // Broadcast position updates at 10 Hz
    this.broadcastInterval = setInterval(() => {
      if (this.currentPayload) {
        this.channel.track(this.currentPayload)
      }
    }, 100)
  }

  updatePosition(x: number, y: number, roomId: string | null) {
    if (!this.currentPayload) return
    this.currentPayload = { ...this.currentPayload, x, y, roomId }
  }

  stop() {
    if (this.broadcastInterval) clearInterval(this.broadcastInterval)
    this.channel.unsubscribe()
  }
}
