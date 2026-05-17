import Phaser from 'phaser'
import type { Emitter } from 'mitt'
import { PlayerAvatar } from '@/game/entities/PlayerAvatar'
import { PresenceSystem } from '@/game/systems/PresenceSystem'
import { DoorSystem } from '@/game/systems/DoorSystem'
import { DecorationSystem } from '@/game/systems/DecorationSystem'
import { MAIN_FLOOR_ROOMS, AGENT_FLOOR_ROOMS, getRoomPixelBounds } from '@/game/systems/AgentRoamSystem'
import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from '@/game/config/gameConfig'
import type { AgentDefinition } from '@/types/agent'
import type { PresencePayload } from '@/types/presence'

export type WindowView = 'city_day' | 'city_night' | 'beach' | 'mountains' | 'forest'
export type FloorId = 'main' | 'agent'

export interface DecorationItem {
  id: string
  floor: FloorId
  type: string
  x: number
  y: number
  rotation: number
}

export type OfficeEvents = {
  agentClick: AgentDefinition
  positionUpdate: { x: number; y: number; worldX: number; worldY: number; scrollX: number; scrollY: number; zoom: number }
  presenceUpdate: Record<string, PresencePayload>
  roomChange: string | null
  doorLocked: { roomId: string; locked: boolean }
  lockRoom: { roomId: string; locked: boolean }
  floorTransition: FloorId
  windowViewChange: WindowView
  proximityUpdate: { userId: string; distance: number; inAudioZone: boolean }[]
  sceneReady: FloorId
  // Decoration events
  setDecorateMode: boolean
  selectDecorationType: string | null
  applyDecorations: DecorationItem[]
  decorationPlaceRequest: { type: string; x: number; y: number }
  decorationMoveRequest: { id: string; x: number; y: number }
  decorationRemoveRequest: { id: string }
}

interface OfficeSceneData {
  userId: string
  displayName: string
  avatarIndex: number
  avatarUrl?: string | null
  division: string | null
  agents: AgentDefinition[]
  supabaseClient: import('@supabase/supabase-js').SupabaseClient
  emitter: Emitter<OfficeEvents>
  floor: FloorId
  windowView: WindowView
  spawnAtStairwell?: boolean
}

// ─── Layout constants (tiles × TILE_SIZE) ────────────────────────────────────
const T = TILE_SIZE

// MAIN FLOOR rooms (Kumospace-style)
const MAIN_ROOMS = {
  stairwell:      { x: T*0,  y: T*2,  w: T*4,  h: T*25 },
  open_plan:      { x: T*4,  y: T*2,  w: T*18, h: T*10 },
  breakout_1:     { x: T*4,  y: T*13, w: T*10, h: T*9  },
  center_meeting: { x: T*15, y: T*13, w: T*15, h: T*9  },
  lounge:         { x: T*4,  y: T*22, w: T*26, h: T*5  },
  corner_office:  { x: T*32, y: T*2,  w: T*18, h: T*16 },
  breakout_2:     { x: T*32, y: T*19, w: T*18, h: T*8  },
}

// AGENT FLOOR rooms
const AGENT_ROOMS = {
  stairwell:    { x: T*0,  y: T*2,  w: T*4,  h: T*25 },
  agent_hub:    { x: T*4,  y: T*2,  w: T*26, h: T*15 },
  server_room:  { x: T*4,  y: T*17, w: T*13, h: T*10 },
  briefing:     { x: T*18, y: T*17, w: T*12, h: T*10 },
  neural_core:  { x: T*32, y: T*2,  w: T*18, h: T*25 },
}

// Corner office window — drawn live, can change view
const WINDOW_RECT = {
  x: MAIN_ROOMS.corner_office.x + T*8,
  y: MAIN_ROOMS.corner_office.y + T*1,
  w: T*9,
  h: T*8,
}

export class OfficeScene extends Phaser.Scene {
  private sceneData!: OfficeSceneData
  private localPlayer!: PlayerAvatar
  private remotePlayers: { [userId: string]: PlayerAvatar } = {}
  private presenceSystem!: PresenceSystem
  private doorSystem!: DoorSystem
  private decorationSystem!: DecorationSystem
  private emitter!: Emitter<OfficeEvents>
  private currentRoomId: string | null = null
  private wasdActive = false
  private posEmitTimer = 0
  private proximityTimer = 0
  private decorateMode = false
  private windowGfx?: Phaser.GameObjects.Graphics
  private stairwellLabel?: Phaser.GameObjects.Text
  private stairwellTimer = 0
  private stairwellArmed = true
  private wasd!: {
    w: Phaser.Input.Keyboard.Key
    a: Phaser.Input.Keyboard.Key
    s: Phaser.Input.Keyboard.Key
    d: Phaser.Input.Keyboard.Key
  }

  constructor() {
    super({ key: 'OfficeScene' })
  }

  init(data: OfficeSceneData) {
    this.sceneData = { ...data, floor: data.floor ?? 'main', windowView: data.windowView ?? 'city_day' }
    this.emitter = data.emitter
    this.currentRoomId = null
    this.remotePlayers = {}
  }

  create() {
    this.drawOffice()
    this.setupDoors()
    this.setupDecorations()
    this.spawnLocalPlayer()
    this.setupCamera()
    this.setupInput()
    this.setupPresence()
    this.listenEmitter()
    // Tear down emitter subscriptions + presence + decorations on scene shutdown/destroy
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup())
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup())
    // Signal React that the scene is fully wired so it can safely emit decorations etc.
    this.emitter.emit('sceneReady', this.sceneData.floor)
  }

  private setupDecorations() {
    this.decorationSystem = new DecorationSystem(this, this.emitter, {
      onPlace: (type, x, y) => this.emitter.emit('decorationPlaceRequest', { type, x, y }),
      onMove: (id, x, y) => this.emitter.emit('decorationMoveRequest', { id, x, y }),
      onRemove: (id) => this.emitter.emit('decorationRemoveRequest', { id }),
    })
  }

  // ──────────────────────────────────────────────────────────────
  // OFFICE DRAWING — dispatches based on floor
  // ──────────────────────────────────────────────────────────────
  private drawOffice() {
    if (this.sceneData.floor === 'agent') this.drawAgentFloor()
    else this.drawMainFloor()
  }

  private drawMainFloor() {
    const W = MAP_WIDTH * T
    const H = MAP_HEIGHT * T
    const g = this.add.graphics()

    // Building shell (dark navy)
    g.fillStyle(0x0d1320, 1)
    g.fillRect(0, 0, W, H)

    // Base corridor floor (warm off-white) — covers the working area
    g.fillStyle(0xe9e3d6, 1)
    g.fillRect(T*4, T*0, T*48, T*30)

    // Subtle corridor tile grid
    g.lineStyle(0.5, 0xd0c7b3, 0.4)
    for (let gx = T*5; gx < T*52; gx += T) g.lineBetween(gx, 0, gx, T*30)
    for (let gy = T; gy < T*30; gy += T) g.lineBetween(T*4, gy, T*52, gy)

    // Light carpet runner through main hallway
    g.fillStyle(0x6366f1, 0.04)
    g.fillRect(T*22, T*2, T*10, T*25)

    // Draw each room on top of base floor
    this.drawStairwell(g, MAIN_ROOMS.stairwell, 'down')
    this.drawOpenPlan(g)
    this.drawBreakout(g, MAIN_ROOMS.breakout_1, 'BREAKOUT')
    this.drawCenterMeeting(g)
    this.drawLounge(g)
    this.drawCornerOfficeBase(g)  // window area gets dark sky placeholder
    this.drawBreakout(g, MAIN_ROOMS.breakout_2, 'BREAKOUT')

    // Walls + door gaps
    this.drawMainFloorWalls(g)

    // Bake static layout
    g.generateTexture('office_bg', W, H)
    g.destroy()
    this.add.image(0, 0, 'office_bg').setOrigin(0, 0)

    // Live window scene (draws on top of baked texture inside the window rect)
    this.windowGfx = this.add.graphics()
    this.drawWindowScene(this.sceneData.windowView)

    // Live room labels
    this.addLabel('OPEN PLAN',     centerX(MAIN_ROOMS.open_plan), MAIN_ROOMS.open_plan.y + 12, '#1e293b', '#ffffffdd')
    this.addLabel('MEETING ROOM',  centerX(MAIN_ROOMS.center_meeting), MAIN_ROOMS.center_meeting.y + 12, '#0f766e', '#ffffffdd')
    this.addLabel('BREAKOUT A',    centerX(MAIN_ROOMS.breakout_1), MAIN_ROOMS.breakout_1.y + 8, '#7c3aed', '#ffffffdd')
    this.addLabel('BREAKOUT B',    centerX(MAIN_ROOMS.breakout_2), MAIN_ROOMS.breakout_2.y + 8, '#7c3aed', '#ffffffdd')
    this.addLabel('LOUNGE',        centerX(MAIN_ROOMS.lounge), MAIN_ROOMS.lounge.y + 8, '#0891b2', '#ffffffdd')
    this.addLabel('✦ CORNER OFFICE', centerX(MAIN_ROOMS.corner_office), MAIN_ROOMS.corner_office.y + 12, '#fbbf24', '#0d1220dd')

    // Stairwell indicator (live, blinking)
    this.stairwellLabel = this.add.text(MAIN_ROOMS.stairwell.x + MAIN_ROOMS.stairwell.w / 2, MAIN_ROOMS.stairwell.y + MAIN_ROOMS.stairwell.h / 2, '↓\nAGENT HUB', {
      fontSize: '12px',
      fontFamily: '"Segoe UI", Arial, sans-serif',
      fontStyle: 'bold',
      color: '#fcd34d',
      backgroundColor: '#1f2937dd',
      align: 'center',
      padding: { x: 6, y: 4 },
    }).setOrigin(0.5).setAlpha(0.95)
    this.tweens.add({ targets: this.stairwellLabel, alpha: { from: 0.5, to: 1 }, duration: 900, yoyo: true, repeat: -1 })
  }

  private drawAgentFloor() {
    const W = MAP_WIDTH * T
    const H = MAP_HEIGHT * T
    const g = this.add.graphics()

    // Deep tech background
    g.fillStyle(0x030714, 1)
    g.fillRect(0, 0, W, H)

    // Base cyber floor
    g.fillStyle(0x0a1228, 1)
    g.fillRect(T*4, T*0, T*48, T*30)

    // Glowing grid
    g.lineStyle(0.5, 0x22d3ee, 0.18)
    for (let gx = T*5; gx < T*52; gx += T) g.lineBetween(gx, 0, gx, T*30)
    for (let gy = T; gy < T*30; gy += T) g.lineBetween(T*4, gy, T*52, gy)

    // Stairwell (going UP back to main)
    this.drawStairwell(g, AGENT_ROOMS.stairwell, 'up')

    // Agent hub (big open hot-desk area with server racks)
    this.drawAgentHub(g)

    // Server room
    this.drawServerRoom(g)

    // Briefing room
    this.drawBriefingRoom(g)

    // Neural core (large central display column)
    this.drawNeuralCore(g)

    // Walls for agent floor
    this.drawAgentFloorWalls(g)

    g.generateTexture('agent_bg', W, H)
    g.destroy()
    this.add.image(0, 0, 'agent_bg').setOrigin(0, 0)

    // Live labels
    this.addLabel('⚡ AGENT HUB',     centerX(AGENT_ROOMS.agent_hub), AGENT_ROOMS.agent_hub.y + 12, '#22d3ee', '#030714dd')
    this.addLabel('SERVER ROOM',     centerX(AGENT_ROOMS.server_room), AGENT_ROOMS.server_room.y + 8, '#67e8f9', '#030714dd')
    this.addLabel('BRIEFING',        centerX(AGENT_ROOMS.briefing), AGENT_ROOMS.briefing.y + 8, '#a78bfa', '#030714dd')
    this.addLabel('◈ NEURAL CORE',   centerX(AGENT_ROOMS.neural_core), AGENT_ROOMS.neural_core.y + 12, '#f472b6', '#030714dd')

    // Stairwell up label
    this.stairwellLabel = this.add.text(AGENT_ROOMS.stairwell.x + AGENT_ROOMS.stairwell.w / 2, AGENT_ROOMS.stairwell.y + AGENT_ROOMS.stairwell.h / 2, '↑\nMAIN FLOOR', {
      fontSize: '12px',
      fontFamily: '"Segoe UI", Arial, sans-serif',
      fontStyle: 'bold',
      color: '#fcd34d',
      backgroundColor: '#1f2937dd',
      align: 'center',
      padding: { x: 6, y: 4 },
    }).setOrigin(0.5).setAlpha(0.95)
    this.tweens.add({ targets: this.stairwellLabel, alpha: { from: 0.5, to: 1 }, duration: 900, yoyo: true, repeat: -1 })
  }

  // ──────────────────────────────────────────────────────────────
  // STAIRWELL
  // ──────────────────────────────────────────────────────────────
  private drawStairwell(g: Phaser.GameObjects.Graphics, rect: { x: number; y: number; w: number; h: number }, direction: 'up' | 'down') {
    const { x, y, w, h } = rect

    // Dark concrete base
    g.fillStyle(0x1f2937, 1)
    g.fillRect(x, y, w, h)

    // Stair steps — alternating shade for depth
    const steps = 14
    const stepH = h / steps
    for (let i = 0; i < steps; i++) {
      const depth = direction === 'down' ? i : steps - 1 - i
      const shade = 0xffffff
      const a = 0.04 + (depth / steps) * 0.12
      g.fillStyle(shade, a)
      g.fillRect(x + 4, y + i * stepH, w - 8, stepH - 2)
      // step edge shadow
      g.fillStyle(0x000000, 0.25)
      g.fillRect(x + 4, y + i * stepH + stepH - 3, w - 8, 2)
    }

    // Side railings
    g.lineStyle(3, 0x9ca3af, 0.9)
    g.lineBetween(x + 8, y, x + 8, y + h)
    g.lineBetween(x + w - 8, y, x + w - 8, y + h)
    g.lineStyle(1, 0xd1d5db, 0.5)
    g.lineBetween(x + 8, y, x + 8, y + h)
    g.lineBetween(x + w - 8, y, x + w - 8, y + h)

    // Railing posts
    const posts = 6
    for (let p = 0; p <= posts; p++) {
      const py = y + (p * h / posts)
      g.fillStyle(0xd1d5db, 0.85)
      g.fillRect(x + 6, py - 2, 6, 4)
      g.fillRect(x + w - 12, py - 2, 6, 4)
    }

    // Glow at entry
    const glowY = direction === 'down' ? y + h - 30 : y + 4
    g.fillStyle(0xfcd34d, 0.18)
    g.fillRect(x + 4, glowY, w - 8, 26)
  }

  // ──────────────────────────────────────────────────────────────
  // MAIN FLOOR ROOMS
  // ──────────────────────────────────────────────────────────────
  private drawOpenPlan(g: Phaser.GameObjects.Graphics) {
    const { x, y, w, h } = MAIN_ROOMS.open_plan

    g.fillStyle(0xf2efe6, 1)
    g.fillRect(x, y, w, h)
    g.lineStyle(0.5, 0xdfd6c2, 0.5)
    for (let gx = x + T; gx < x + w; gx += T) g.lineBetween(gx, y, gx, y + h)
    for (let gy = y + T; gy < y + h; gy += T) g.lineBetween(x, gy, x + w, gy)

    // Carpet runner down center
    g.fillStyle(0x6366f1, 0.08)
    g.fillRect(x + w * 0.25, y + 12, w * 0.5, h - 24)

    // Desk pods (2 rows × 3 columns)
    const dw = 70, dh = 36
    const cols = 3, rows = 2
    const padX = Math.round((w - cols * dw - (cols - 1) * 28) / 2)
    const padY = 50

    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const px = x + padX + c * (dw + 28)
        const py = y + padY + r * (dh + 56)
        this.drawDesk(g, px, py, r === 0)
      }
    }

    // Reception counter (right side of open plan, by corridor)
    const rx = x + w - 140, ry = y + h - 50
    g.fillStyle(0x000000, 0.1)
    g.fillRoundedRect(rx + 3, ry + 4, 130, 38, 5)
    g.fillStyle(0x2d3748, 1)
    g.fillRoundedRect(rx, ry, 130, 38, 5)
    g.fillStyle(0x3d4a5c, 0.6)
    g.fillRoundedRect(rx + 2, ry + 2, 126, 14, 4)
    g.lineStyle(1.5, 0x1a202c, 1)
    g.strokeRoundedRect(rx, ry, 130, 38, 5)
    // Monitor on counter
    g.fillStyle(0x0f172a, 1)
    g.fillRoundedRect(rx + 44, ry - 22, 42, 24, 3)
    g.fillStyle(0x2563eb, 1)
    g.fillRoundedRect(rx + 46, ry - 20, 38, 18, 2)
    g.fillStyle(0x60a5fa, 0.3)
    g.fillRect(rx + 46, ry - 20, 38, 8)

    // Whiteboard (top wall)
    g.fillStyle(0xfafafa, 1)
    g.fillRoundedRect(x + 22, y + 12, 100, 50, 3)
    g.lineStyle(1.5, 0xcbd5e1, 1)
    g.strokeRoundedRect(x + 22, y + 12, 100, 50, 3)
    g.lineStyle(2, 0x3b82f6, 0.7)
    g.lineBetween(x + 30, y + 26, x + 70, y + 30)
    g.lineStyle(1.5, 0xef4444, 0.6)
    g.lineBetween(x + 30, y + 40, x + 80, y + 44)
    g.lineStyle(1.5, 0x22c55e, 0.55)
    g.lineBetween(x + 30, y + 52, x + 64, y + 56)

    // Plants
    this.drawPlant(g, x + 18, y + h - 16, 12)
    this.drawPlant(g, x + w - 18, y + 18, 13)
    this.drawPlant(g, x + w - 18, y + h - 16, 11)
  }

  private drawBreakout(g: Phaser.GameObjects.Graphics, rect: { x: number; y: number; w: number; h: number }, _label: string) {
    const { x, y, w, h } = rect

    // Soft accent floor
    g.fillStyle(0xfdf4ff, 1)
    g.fillRect(x, y, w, h)
    g.lineStyle(0.5, 0xe9d5ff, 0.5)
    for (let gx = x + T; gx < x + w; gx += T) g.lineBetween(gx, y, gx, y + h)
    for (let gy = y + T; gy < y + h; gy += T) g.lineBetween(x, gy, x + w, gy)

    // Rug
    g.fillStyle(0x7c3aed, 0.1)
    g.fillRoundedRect(x + 16, y + 24, w - 32, h - 48, 8)

    // Round meeting table (centered)
    const cx = x + w / 2, cy = y + h / 2
    g.fillStyle(0x000000, 0.13)
    g.fillEllipse(cx + 4, cy + 5, 90, 60)
    g.fillStyle(0x5c3317, 1)
    g.fillEllipse(cx, cy, 90, 60)
    g.fillStyle(0x7a4520, 0.5)
    g.fillEllipse(cx, cy - 4, 86, 12)
    g.lineStyle(2, 0x3d1f0a, 1)
    g.strokeEllipse(cx, cy, 90, 60)

    // 4 chairs around table
    const seats: Array<[number, number, boolean]> = [
      [cx, cy - 42, false],
      [cx, cy + 42, false],
      [cx - 56, cy, true],
      [cx + 56, cy, true],
    ]
    seats.forEach(([sx, sy, rot]) => {
      const cw = rot ? 20 : 26
      const ch = rot ? 26 : 20
      g.fillStyle(0x000000, 0.1)
      g.fillRoundedRect(sx - cw / 2 + 2, sy - ch / 2 + 3, cw, ch, 4)
      g.fillStyle(0x1e3a5f, 1)
      g.fillRoundedRect(sx - cw / 2, sy - ch / 2, cw, ch, 4)
      g.lineStyle(1, 0x2a4f7c, 1)
      g.strokeRoundedRect(sx - cw / 2, sy - ch / 2, cw, ch, 4)
    })

    // Wall TV
    g.fillStyle(0x0c0c14, 1)
    g.fillRoundedRect(x + w / 2 - 28, y + 8, 56, 30, 3)
    g.fillStyle(0x1d4ed8, 1)
    g.fillRoundedRect(x + w / 2 - 26, y + 10, 52, 26, 2)
    g.fillStyle(0x60a5fa, 0.25)
    g.fillRect(x + w / 2 - 26, y + 10, 52, 12)

    // Plants
    this.drawPlant(g, x + 16, y + 18, 10)
    this.drawPlant(g, x + w - 16, y + h - 16, 10)
  }

  private drawCenterMeeting(g: Phaser.GameObjects.Graphics) {
    const { x, y, w, h } = MAIN_ROOMS.center_meeting

    g.fillStyle(0xf8fafc, 1)
    g.fillRect(x, y, w, h)

    // Subtle radial rug
    g.fillStyle(0x0ea5e9, 0.05)
    g.fillEllipse(x + w / 2, y + h / 2, w - 20, h - 20)
    g.lineStyle(1.5, 0x0ea5e9, 0.12)
    g.strokeEllipse(x + w / 2, y + h / 2, w - 30, h - 30)

    // Conference table
    const tw = w - 60, th = h - 80
    const tx = x + 30, ty = y + 44
    g.fillStyle(0x000000, 0.12)
    g.fillRoundedRect(tx + 5, ty + 6, tw, th, 8)
    g.fillStyle(0x5c3317, 1)
    g.fillRoundedRect(tx, ty, tw, th, 8)
    g.fillStyle(0x7a4520, 0.5)
    g.fillRoundedRect(tx + 3, ty + 3, tw - 6, 18, 6)
    g.lineStyle(2, 0x3d1f0a, 1)
    g.strokeRoundedRect(tx, ty, tw, th, 8)

    // Glasses
    for (let i = 0; i < 5; i++) {
      const gx = tx + tw * (0.14 + i * 0.18)
      g.fillStyle(0xbae6fd, 0.7)
      g.fillEllipse(gx, ty + th / 2, 8, 10)
      g.lineStyle(1, 0x7dd3fc, 0.8)
      g.strokeEllipse(gx, ty + th / 2, 8, 10)
    }

    // Laptop centerpiece
    g.fillStyle(0x1e293b, 1)
    g.fillRoundedRect(tx + tw / 2 - 18, ty + th / 2 - 9, 36, 22, 2)
    g.fillStyle(0x2563eb, 1)
    g.fillRoundedRect(tx + tw / 2 - 16, ty + th / 2 - 7, 32, 16, 2)
    g.fillStyle(0x60a5fa, 0.25)
    g.fillRect(tx + tw / 2 - 16, ty + th / 2 - 7, 32, 8)

    // Chairs all sides
    const chairs: Array<[number, number, boolean]> = []
    for (let i = 0; i < 4; i++) {
      const cx = tx + (tw / 5) * (i + 1)
      chairs.push([cx, ty - 18, false])
      chairs.push([cx, ty + th + 18, false])
    }
    chairs.push([tx - 18, ty + th / 2, true])
    chairs.push([tx + tw + 18, ty + th / 2, true])
    chairs.forEach(([cx, cy, rot]) => {
      const cw = rot ? 22 : 28
      const ch = rot ? 28 : 22
      g.fillStyle(0x000000, 0.1)
      g.fillRoundedRect(cx - cw / 2 + 2, cy - ch / 2 + 3, cw, ch, 5)
      g.fillStyle(0x1e3a5f, 1)
      g.fillRoundedRect(cx - cw / 2, cy - ch / 2, cw, ch, 5)
      g.lineStyle(1, 0x2a4f7c, 1)
      g.strokeRoundedRect(cx - cw / 2, cy - ch / 2, cw, ch, 5)
    })

    // TV
    const tvX = x + w / 2 - 44, tvY = y + 8
    g.fillStyle(0x0c0c14, 1)
    g.fillRoundedRect(tvX, tvY, 88, 32, 3)
    g.fillStyle(0x1d4ed8, 1)
    g.fillRoundedRect(tvX + 2, tvY + 2, 84, 28, 2)
    g.fillStyle(0x60a5fa, 0.25)
    g.fillRect(tvX + 2, tvY + 2, 84, 12)
    g.fillStyle(0xffffff, 0.08)
    g.fillRect(tvX + 8, tvY + 18, 50, 4)
    g.fillRect(tvX + 8, tvY + 24, 34, 3)

    // Plants
    this.drawPlant(g, x + 14, y + 14, 12)
    this.drawPlant(g, x + w - 14, y + 14, 12)
    this.drawPlant(g, x + 14, y + h - 14, 11)
    this.drawPlant(g, x + w - 14, y + h - 14, 11)
  }

  private drawLounge(g: Phaser.GameObjects.Graphics) {
    const { x, y, w, h } = MAIN_ROOMS.lounge

    // Warm hardwood floor
    g.fillStyle(0xd4a373, 1)
    g.fillRect(x, y, w, h)
    // Wood plank lines
    g.lineStyle(1, 0xa97a4d, 0.4)
    for (let gy = y; gy < y + h; gy += 16) g.lineBetween(x, gy, x + w, gy)
    for (let gx = x + 30; gx < x + w; gx += 90) g.lineBetween(gx, y, gx, y + h)

    // Big area rug
    g.fillStyle(0x7c2d12, 0.18)
    g.fillRoundedRect(x + 28, y + 16, w - 56, h - 32, 10)
    g.lineStyle(1, 0x9a3412, 0.3)
    g.strokeRoundedRect(x + 28, y + 16, w - 56, h - 32, 10)

    // POOL TABLE (centered)
    const ptW = 180, ptH = 90
    const ptX = x + w / 2 - ptW / 2
    const ptY = y + h / 2 - ptH / 2 + 4

    g.fillStyle(0x000000, 0.25)
    g.fillRoundedRect(ptX + 4, ptY + 5, ptW, ptH, 8)
    // Wood frame
    g.fillStyle(0x4a1d0a, 1)
    g.fillRoundedRect(ptX, ptY, ptW, ptH, 8)
    g.lineStyle(2, 0x2a0e02, 1)
    g.strokeRoundedRect(ptX, ptY, ptW, ptH, 8)
    // Felt
    g.fillStyle(0x166534, 1)
    g.fillRoundedRect(ptX + 10, ptY + 10, ptW - 20, ptH - 20, 4)
    g.fillStyle(0x15803d, 0.6)
    g.fillRoundedRect(ptX + 12, ptY + 12, ptW - 24, 12, 4)
    // Pockets (corners + middle of long sides)
    const pockets: [number, number][] = [
      [ptX + 12, ptY + 12], [ptX + ptW - 12, ptY + 12],
      [ptX + 12, ptY + ptH - 12], [ptX + ptW - 12, ptY + ptH - 12],
      [ptX + ptW / 2, ptY + 12], [ptX + ptW / 2, ptY + ptH - 12],
    ]
    pockets.forEach(([px, py]) => {
      g.fillStyle(0x000000, 1)
      g.fillCircle(px, py, 6)
    })
    // Balls
    const ballColors = [0xfacc15, 0xef4444, 0x3b82f6, 0xf97316, 0x10b981, 0xa855f7, 0xfbbf24]
    ballColors.forEach((c, i) => {
      g.fillStyle(0x000000, 0.4)
      g.fillCircle(ptX + 60 + i * 9 + 1, ptY + ptH / 2 + 1, 4)
      g.fillStyle(c, 1)
      g.fillCircle(ptX + 60 + i * 9, ptY + ptH / 2, 4)
    })
    // Cue ball
    g.fillStyle(0xffffff, 1)
    g.fillCircle(ptX + 40, ptY + ptH / 2 - 4, 4)
    // Cue stick
    g.lineStyle(3, 0x92400e, 1)
    g.lineBetween(ptX - 14, ptY - 6, ptX + 26, ptY + 22)

    // Sofas (top + bottom, facing center)
    const sofaW = 110, sofaH = 28
    // Top sofa
    g.fillStyle(0x000000, 0.12)
    g.fillRoundedRect(x + 60 + 3, y + 16 + 3, sofaW, sofaH, 6)
    g.fillStyle(0x991b1b, 1)
    g.fillRoundedRect(x + 60, y + 16, sofaW, sofaH, 6)
    g.fillStyle(0xb91c1c, 1)
    g.fillRoundedRect(x + 62, y + 18, sofaW - 4, 14, 5)
    g.lineStyle(1, 0x7f1d1d, 1)
    g.strokeRoundedRect(x + 60, y + 16, sofaW, sofaH, 6)
    // Bottom sofa
    g.fillStyle(0x000000, 0.12)
    g.fillRoundedRect(x + w - 60 - sofaW + 3, y + h - sofaH - 16 + 3, sofaW, sofaH, 6)
    g.fillStyle(0x991b1b, 1)
    g.fillRoundedRect(x + w - 60 - sofaW, y + h - sofaH - 16, sofaW, sofaH, 6)
    g.fillStyle(0xb91c1c, 1)
    g.fillRoundedRect(x + w - 60 - sofaW + 2, y + h - sofaH - 14, sofaW - 4, 14, 5)
    g.lineStyle(1, 0x7f1d1d, 1)
    g.strokeRoundedRect(x + w - 60 - sofaW, y + h - sofaH - 16, sofaW, sofaH, 6)

    // Mini-fridge
    const fX = x + w - 50, fY = y + h / 2 - 22
    g.fillStyle(0x000000, 0.18)
    g.fillRoundedRect(fX + 3, fY + 4, 28, 44, 3)
    g.fillStyle(0xe5e7eb, 1)
    g.fillRoundedRect(fX, fY, 28, 44, 3)
    g.lineStyle(1, 0x9ca3af, 1)
    g.strokeRoundedRect(fX, fY, 28, 44, 3)
    g.lineStyle(1, 0x9ca3af, 0.8)
    g.lineBetween(fX, fY + 22, fX + 28, fY + 22)
    g.fillStyle(0x6b7280, 1)
    g.fillRect(fX + 22, fY + 4, 3, 8)
    g.fillRect(fX + 22, fY + 26, 3, 8)

    // Plants
    this.drawPlant(g, x + 18, y + 14, 11)
    this.drawPlant(g, x + w - 18, y + 14, 11)
    this.drawPlant(g, x + 18, y + h - 14, 11)
  }

  private drawCornerOfficeBase(g: Phaser.GameObjects.Graphics) {
    const { x, y, w, h } = MAIN_ROOMS.corner_office

    // Dark luxury floor
    g.fillStyle(0x0d1220, 1)
    g.fillRect(x, y, w, h)
    g.lineStyle(1, 0x1e2d4a, 0.4)
    for (let d = -h; d < w + h; d += 32) {
      g.lineBetween(
        x + Math.max(0, d), y + Math.max(0, -d),
        x + Math.min(w, d + h), y + Math.min(h, h - d)
      )
    }

    // Dark carpet
    g.fillStyle(0x1e1b4b, 0.85)
    g.fillRoundedRect(x + 24, y + 16, w - 48, h - 40, 6)

    // Bookshelf (left wall)
    g.fillStyle(0x3b2a14, 1)
    g.fillRect(x + 8, y + 16, 18, h - 36)
    g.lineStyle(1, 0x261c0e, 1)
    g.strokeRect(x + 8, y + 16, 18, h - 36)
    const bc = [0xdc2626, 0x2563eb, 0x16a34a, 0xd97706, 0x7c3aed, 0x0891b2, 0xb45309]
    const shelves = 7
    const sh = (h - 36) / shelves
    for (let s = 0; s < shelves; s++) {
      g.lineStyle(1, 0x261c0e, 0.5)
      g.lineBetween(x + 8, y + 16 + s * sh, x + 26, y + 16 + s * sh)
      for (let b = 0; b < 2; b++) {
        g.fillStyle(bc[(s * 2 + b) % bc.length], 0.9)
        g.fillRect(x + 10 + b * 7, y + 18 + s * sh, 6, sh - 6)
      }
    }

    // Window placeholder rect (will be overdrawn by live window scene)
    g.fillStyle(0x0a1428, 1)
    g.fillRect(WINDOW_RECT.x, WINDOW_RECT.y, WINDOW_RECT.w, WINDOW_RECT.h)

    // Below the window — luxurious credenza
    const credW = WINDOW_RECT.w, credH = 28
    const credX = WINDOW_RECT.x
    const credY = WINDOW_RECT.y + WINDOW_RECT.h + 12
    g.fillStyle(0x000000, 0.18)
    g.fillRoundedRect(credX + 3, credY + 4, credW, credH, 4)
    g.fillStyle(0x1c0f08, 1)
    g.fillRoundedRect(credX, credY, credW, credH, 4)
    g.fillStyle(0x2d1a0c, 0.5)
    g.fillRoundedRect(credX + 2, credY + 2, credW - 4, 9, 3)
    g.lineStyle(1.5, 0x0a0704, 1)
    g.strokeRoundedRect(credX, credY, credW, credH, 4)
    // Decanter + glasses
    g.fillStyle(0xfbbf24, 0.6)
    g.fillEllipse(credX + 30, credY + 12, 18, 14)
    g.fillStyle(0xfde68a, 0.7)
    g.fillEllipse(credX + 30, credY + 6, 10, 6)
    g.fillStyle(0xbae6fd, 0.6)
    g.fillEllipse(credX + 56, credY + 14, 8, 10)
    g.fillEllipse(credX + 70, credY + 14, 8, 10)

    // L-shaped executive desk (under window, bottom-left of office)
    const edx = x + 36, edy = y + h - 130
    g.fillStyle(0x000000, 0.18)
    g.fillRoundedRect(edx + 3, edy + 4, 160, 50, 3)
    g.fillStyle(0x1c0f08, 1)
    g.fillRoundedRect(edx, edy, 160, 50, 3)
    g.fillRoundedRect(edx, edy, 48, 110, 3)
    g.fillStyle(0x2d1a0c, 0.5)
    g.fillRoundedRect(edx + 2, edy + 2, 156, 14, 3)
    g.fillRoundedRect(edx + 2, edy + 2, 14, 106, 3)
    g.lineStyle(1.5, 0x0a0704, 1)
    g.strokeRoundedRect(edx, edy, 160, 50, 3)
    g.strokeRoundedRect(edx, edy, 48, 110, 3)
    // Monitor
    g.fillStyle(0x0c0c14, 1)
    g.fillRoundedRect(edx + 60, edy + 6, 84, 36, 3)
    g.fillStyle(0x1d4ed8, 1)
    g.fillRoundedRect(edx + 62, edy + 8, 80, 28, 3)
    g.fillStyle(0x60a5fa, 0.25)
    g.fillRect(edx + 62, edy + 8, 80, 14)
    // Laptop on side wing
    g.fillStyle(0x1e293b, 1)
    g.fillRoundedRect(edx + 7, edy + 64, 34, 24, 3)
    g.fillStyle(0x334155, 1)
    g.fillRoundedRect(edx + 9, edy + 66, 30, 18, 2)
    // Exec chair
    g.fillStyle(0x000000, 0.14)
    g.fillRoundedRect(edx + 70, edy + 64, 60, 40, 7)
    g.fillStyle(0x060608, 1)
    g.fillRoundedRect(edx + 68, edy + 62, 60, 40, 7)
    g.lineStyle(1.5, 0x14141e, 1)
    g.strokeRoundedRect(edx + 68, edy + 62, 60, 40, 7)
    g.fillStyle(0x0f0f18, 0.8)
    g.fillRoundedRect(edx + 72, edy + 66, 52, 14, 4)

    // Gold corner accents
    g.lineStyle(4, 0xd4aa38, 0.9)
    g.lineBetween(x + 2, y + 2, x + 30, y + 2)
    g.lineBetween(x + 2, y + 2, x + 2, y + 30)
    g.lineBetween(x + w - 2, y + 2, x + w - 30, y + 2)
    g.lineBetween(x + w - 2, y + 2, x + w - 2, y + 30)
    g.lineBetween(x + 2, y + h - 2, x + 30, y + h - 2)
    g.lineBetween(x + 2, y + h - 2, x + 2, y + h - 30)
    g.lineBetween(x + w - 2, y + h - 2, x + w - 30, y + h - 2)
    g.lineBetween(x + w - 2, y + h - 2, x + w - 2, y + h - 30)

    // Decorative plant
    this.drawPlant(g, x + 32, y + h - 36, 13)
  }

  // ──────────────────────────────────────────────────────────────
  // WINDOW VIEW (live, redrawable)
  // ──────────────────────────────────────────────────────────────
  public drawWindowScene(view: WindowView) {
    if (!this.windowGfx) return
    this.windowGfx.clear()
    if (this.sceneData.floor !== 'main') return
    const { x, y, w, h } = WINDOW_RECT
    const g = this.windowGfx

    switch (view) {
      case 'city_day':       this.scenicCityDay(g, x, y, w, h); break
      case 'city_night':     this.scenicCityNight(g, x, y, w, h); break
      case 'beach':          this.scenicBeach(g, x, y, w, h); break
      case 'mountains':      this.scenicMountains(g, x, y, w, h); break
      case 'forest':         this.scenicForest(g, x, y, w, h); break
    }
    // Window frame and panes — drawn on top of scene
    this.drawWindowFrame(g, x, y, w, h)
    this.sceneData.windowView = view
  }

  private drawWindowFrame(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    // Outer dark frame
    g.lineStyle(6, 0x1c0f08, 1)
    g.strokeRect(x, y, w, h)
    g.lineStyle(2, 0xd4aa38, 0.6)
    g.strokeRect(x + 2, y + 2, w - 4, h - 4)
    // Pane dividers (cross)
    const mx = x + w / 2, my = y + h / 2
    g.fillStyle(0x1c0f08, 1)
    g.fillRect(mx - 2, y + 2, 4, h - 4)
    g.fillRect(x + 2, my - 2, w - 4, 4)
    g.fillStyle(0xd4aa38, 0.4)
    g.fillRect(mx - 1, y + 4, 2, h - 8)
    g.fillRect(x + 4, my - 1, w - 8, 2)
    // Soft window glare
    g.fillStyle(0xffffff, 0.07)
    g.fillRect(x + 4, y + 4, w / 2 - 6, h / 3)
  }

  private scenicCityDay(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    // Sky gradient
    for (let i = 0; i < h * 0.65; i++) {
      const t = i / (h * 0.65)
      const r = Math.floor(0x60 + (0xc6 - 0x60) * t)
      const gr = Math.floor(0xa5 + (0xe5 - 0xa5) * t)
      const b = Math.floor(0xfa + (0xff - 0xfa) * t)
      g.fillStyle((r << 16) | (gr << 8) | b, 1)
      g.fillRect(x, y + i, w, 1)
    }
    // Sun
    g.fillStyle(0xfde68a, 0.7)
    g.fillCircle(x + w - 50, y + 40, 22)
    g.fillStyle(0xfef3c7, 0.9)
    g.fillCircle(x + w - 50, y + 40, 14)
    // Clouds
    g.fillStyle(0xffffff, 0.8)
    g.fillEllipse(x + 60, y + 50, 50, 18)
    g.fillEllipse(x + 50, y + 56, 36, 14)
    g.fillEllipse(x + w / 2, y + 30, 60, 16)
    // Skyline
    const baseY = y + h * 0.7
    const buildings = [
      { bx: 0,   bw: 28, bh: 90, c: 0x475569 },
      { bx: 30,  bw: 36, bh: 130, c: 0x334155 },
      { bx: 70,  bw: 22, bh: 70, c: 0x52525b },
      { bx: 95,  bw: 30, bh: 110, c: 0x3f3f46 },
      { bx: 130, bw: 28, bh: 85, c: 0x475569 },
      { bx: 162, bw: 38, bh: 145, c: 0x1e293b },
      { bx: 205, bw: 24, bh: 75, c: 0x52525b },
      { bx: 232, bw: 32, bh: 105, c: 0x334155 },
    ]
    buildings.forEach((b) => {
      g.fillStyle(b.c, 1)
      g.fillRect(x + b.bx, baseY - b.bh, b.bw, b.bh + h)
      // Windows
      for (let wy = baseY - b.bh + 8; wy < baseY - 6; wy += 8) {
        for (let wx = x + b.bx + 4; wx < x + b.bx + b.bw - 4; wx += 6) {
          g.fillStyle(0xfde047, Math.random() > 0.6 ? 0.5 : 0.15)
          g.fillRect(wx, wy, 3, 4)
        }
      }
    })
    // Ground haze
    g.fillStyle(0x60a5fa, 0.15)
    g.fillRect(x, baseY - 6, w, 12)
  }

  private scenicCityNight(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    // Night sky gradient (deep navy → indigo)
    for (let i = 0; i < h; i++) {
      const t = i / h
      const r = Math.floor(0x0c + (0x1e - 0x0c) * t)
      const gr = Math.floor(0x1a + (0x29 - 0x1a) * t)
      const b = Math.floor(0x3a + (0x4f - 0x3a) * t)
      g.fillStyle((r << 16) | (gr << 8) | b, 1)
      g.fillRect(x, y + i, w, 1)
    }
    // Stars
    for (let s = 0; s < 35; s++) {
      const sx = x + Math.random() * w
      const sy = y + Math.random() * h * 0.6
      g.fillStyle(0xffffff, 0.5 + Math.random() * 0.5)
      g.fillCircle(sx, sy, Math.random() * 1.2 + 0.5)
    }
    // Moon
    g.fillStyle(0xfef9c3, 0.95)
    g.fillCircle(x + 50, y + 36, 18)
    g.fillStyle(0xfde047, 0.18)
    g.fillCircle(x + 50, y + 36, 28)
    // Skyline (lit windows)
    const baseY = y + h * 0.7
    const buildings = [
      { bx: 0,   bw: 32, bh: 105 },
      { bx: 36,  bw: 28, bh: 80 },
      { bx: 70,  bw: 36, bh: 140 },
      { bx: 110, bw: 24, bh: 90 },
      { bx: 140, bw: 32, bh: 120 },
      { bx: 178, bw: 28, bh: 95 },
      { bx: 212, bw: 38, bh: 155 },
    ]
    buildings.forEach((b) => {
      g.fillStyle(0x111827, 1)
      g.fillRect(x + b.bx, baseY - b.bh, b.bw, b.bh + h)
      for (let wy = baseY - b.bh + 8; wy < baseY - 6; wy += 8) {
        for (let wx = x + b.bx + 4; wx < x + b.bx + b.bw - 4; wx += 6) {
          const lit = Math.random() > 0.4
          g.fillStyle(lit ? 0xfde047 : 0x1f2937, lit ? 0.85 : 0.3)
          g.fillRect(wx, wy, 3, 4)
        }
      }
    })
  }

  private scenicBeach(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    // Sky sunset gradient
    for (let i = 0; i < h * 0.55; i++) {
      const t = i / (h * 0.55)
      const r = Math.floor(0xfb + (0xfd - 0xfb) * t)
      const gr = Math.floor(0xbf + (0xe0 - 0xbf) * t)
      const b = Math.floor(0x24 + (0x88 - 0x24) * t)
      g.fillStyle((r << 16) | (gr << 8) | b, 1)
      g.fillRect(x, y + i, w, 1)
    }
    // Sun
    g.fillStyle(0xfde047, 0.6)
    g.fillCircle(x + w / 2, y + h * 0.5, 28)
    g.fillStyle(0xfef9c3, 0.95)
    g.fillCircle(x + w / 2, y + h * 0.5, 18)
    // Ocean
    g.fillStyle(0x0e7490, 1)
    g.fillRect(x, y + h * 0.55, w, h * 0.3)
    g.fillStyle(0x06b6d4, 1)
    g.fillRect(x, y + h * 0.55, w, 8)
    // Waves
    for (let i = 0; i < 5; i++) {
      g.fillStyle(0xffffff, 0.4)
      g.fillEllipse(x + 20 + i * 50, y + h * 0.6 + (i % 2) * 6, 30, 3)
    }
    // Sand
    g.fillStyle(0xfde68a, 1)
    g.fillRect(x, y + h * 0.85, w, h * 0.15)
    g.fillStyle(0xfacc15, 0.3)
    g.fillRect(x, y + h * 0.85, w, 5)
    // Palm tree silhouette
    g.fillStyle(0x1c1917, 0.9)
    g.fillRect(x + w - 28, y + h * 0.4, 4, h * 0.5)
    for (let f = 0; f < 5; f++) {
      const a = (f / 5) * Math.PI * 2
      g.fillTriangle(
        x + w - 26, y + h * 0.4,
        x + w - 26 + Math.cos(a) * 20, y + h * 0.4 + Math.sin(a) * 14,
        x + w - 26 + Math.cos(a + 0.3) * 25, y + h * 0.4 + Math.sin(a + 0.3) * 16
      )
    }
  }

  private scenicMountains(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    // Crisp morning sky
    for (let i = 0; i < h; i++) {
      const t = i / h
      const r = Math.floor(0xbf + (0xf0 - 0xbf) * t)
      const gr = Math.floor(0xdb + (0xf4 - 0xdb) * t)
      const b = Math.floor(0xfe + (0xf8 - 0xfe) * t)
      g.fillStyle((r << 16) | (gr << 8) | b, 1)
      g.fillRect(x, y + i, w, 1)
    }
    // Distant peaks
    g.fillStyle(0x6b7280, 0.8)
    g.fillTriangle(x, y + h * 0.7, x + 80, y + h * 0.32, x + 140, y + h * 0.65)
    g.fillTriangle(x + 100, y + h * 0.6, x + 180, y + h * 0.28, x + 260, y + h * 0.62)
    g.fillTriangle(x + 200, y + h * 0.7, x + w, y + h * 0.4, x + w, y + h * 0.7)
    // Snow caps
    g.fillStyle(0xffffff, 1)
    g.fillTriangle(x + 70, y + h * 0.36, x + 80, y + h * 0.32, x + 92, y + h * 0.38)
    g.fillTriangle(x + 168, y + h * 0.31, x + 180, y + h * 0.28, x + 194, y + h * 0.33)
    // Closer peaks
    g.fillStyle(0x4b5563, 0.95)
    g.fillTriangle(x, y + h * 0.85, x + 100, y + h * 0.5, x + 180, y + h * 0.78)
    g.fillTriangle(x + 130, y + h * 0.78, x + 220, y + h * 0.55, x + w, y + h * 0.82)
    // Pine trees foreground
    g.fillStyle(0x14532d, 1)
    for (let p = 0; p < 8; p++) {
      const px = x + 10 + p * 32 + (p % 2) * 10
      const py = y + h * 0.88
      g.fillTriangle(px, py - 28, px - 10, py, px + 10, py)
      g.fillTriangle(px, py - 36, px - 7, py - 14, px + 7, py - 14)
    }
    // Ground
    g.fillStyle(0x166534, 1)
    g.fillRect(x, y + h * 0.92, w, h * 0.08)
  }

  private scenicForest(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    // Dappled green
    g.fillStyle(0x14532d, 1)
    g.fillRect(x, y, w, h)
    // Light rays
    for (let r = 0; r < 6; r++) {
      const rx = x + (r * w) / 6 + 10
      g.fillStyle(0xfde047, 0.06)
      g.fillTriangle(rx, y, rx - 30, y + h, rx + 30, y + h)
    }
    // Tree trunks
    for (let t = 0; t < 5; t++) {
      const tx = x + 20 + t * 50
      g.fillStyle(0x451a03, 1)
      g.fillRect(tx, y + h * 0.2, 10, h * 0.8)
      g.fillStyle(0x78350f, 0.4)
      g.fillRect(tx + 2, y + h * 0.2, 3, h * 0.8)
    }
    // Canopy clusters
    for (let c = 0; c < 14; c++) {
      const cx = x + (c * 22) + (c % 2) * 12
      const cy = y + 18 + (c % 3) * 12
      g.fillStyle(0x166534, 0.9)
      g.fillCircle(cx, cy, 18)
      g.fillStyle(0x22c55e, 0.7)
      g.fillCircle(cx - 6, cy - 5, 10)
      g.fillStyle(0x4ade80, 0.5)
      g.fillCircle(cx + 6, cy - 8, 7)
    }
    // Forest floor
    g.fillStyle(0x365314, 1)
    g.fillRect(x, y + h * 0.92, w, h * 0.08)
  }

  // ──────────────────────────────────────────────────────────────
  // AGENT FLOOR ROOMS
  // ──────────────────────────────────────────────────────────────
  private drawAgentHub(g: Phaser.GameObjects.Graphics) {
    const { x, y, w, h } = AGENT_ROOMS.agent_hub

    g.fillStyle(0x0c1a30, 1)
    g.fillRect(x, y, w, h)
    g.lineStyle(0.5, 0x22d3ee, 0.15)
    for (let gx = x + T; gx < x + w; gx += T) g.lineBetween(gx, y, gx, y + h)
    for (let gy = y + T; gy < y + h; gy += T) g.lineBetween(x, gy, x + w, gy)

    // Glowing floor lanes
    g.fillStyle(0x06b6d4, 0.08)
    g.fillRect(x + 20, y + 30, w - 40, 4)
    g.fillRect(x + 20, y + h - 40, w - 40, 4)

    // Hot desks (4 rows × 4)
    const dw = 64, dh = 30
    const cols = 4, rows = 4
    const padX = Math.round((w - cols * dw - (cols - 1) * 18) / 2)
    const padY = 50
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const px = x + padX + c * (dw + 18)
        const py = y + padY + r * (dh + 32)
        this.drawCyberDesk(g, px, py)
      }
    }

    // Title display (central holo-style)
    const cx = x + w / 2, cy = y + h - 24
    g.fillStyle(0x06b6d4, 0.12)
    g.fillRoundedRect(cx - 60, cy - 14, 120, 22, 6)
    g.lineStyle(1, 0x22d3ee, 0.8)
    g.strokeRoundedRect(cx - 60, cy - 14, 120, 22, 6)
  }

  private drawCyberDesk(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    const dw = 64, dh = 30
    g.fillStyle(0x000000, 0.3)
    g.fillRoundedRect(x + 2, y + 3, dw, dh, 3)
    g.fillStyle(0x0f172a, 1)
    g.fillRoundedRect(x, y, dw, dh, 3)
    g.lineStyle(1, 0x22d3ee, 0.5)
    g.strokeRoundedRect(x, y, dw, dh, 3)
    // Monitor
    g.fillStyle(0x000d1a, 1)
    g.fillRoundedRect(x + 12, y - 18, 40, 22, 2)
    g.fillStyle(0x22d3ee, 0.7)
    g.fillRect(x + 16, y - 14, 26, 2)
    g.fillStyle(0x22d3ee, 0.4)
    g.fillRect(x + 16, y - 9, 32, 2)
    g.fillRect(x + 16, y - 4, 18, 2)
    // Cursor
    g.fillStyle(0x22d3ee, 1)
    g.fillRect(x + 16, y - 4, 3, 2)
    // Chair
    g.fillStyle(0x111827, 1)
    g.fillRoundedRect(x + 18, y + 32, 28, 18, 4)
    g.lineStyle(1, 0x22d3ee, 0.4)
    g.strokeRoundedRect(x + 18, y + 32, 28, 18, 4)
  }

  private drawServerRoom(g: Phaser.GameObjects.Graphics) {
    const { x, y, w, h } = AGENT_ROOMS.server_room
    g.fillStyle(0x060c1a, 1)
    g.fillRect(x, y, w, h)
    g.lineStyle(0.5, 0x22d3ee, 0.18)
    for (let gx = x + T; gx < x + w; gx += T) g.lineBetween(gx, y, gx, y + h)
    for (let gy = y + T; gy < y + h; gy += T) g.lineBetween(x, gy, x + w, gy)
    // Rack rows
    const rackW = 30, rackH = 90
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const rx = x + 24 + col * 100, ry = y + 30 + row * (rackH + 30)
        this.drawServerRack(g, rx, ry, rackW, rackH)
      }
    }
  }

  private drawServerRack(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    g.fillStyle(0x000000, 0.25)
    g.fillRoundedRect(x + 3, y + 4, w, h, 2)
    g.fillStyle(0x111827, 1)
    g.fillRoundedRect(x, y, w, h, 2)
    g.lineStyle(1, 0x22d3ee, 0.4)
    g.strokeRoundedRect(x, y, w, h, 2)
    for (let u = 0; u < 6; u++) {
      g.lineStyle(0.5, 0x374151, 0.7)
      g.lineBetween(x + 2, y + 12 + u * 13, x + w - 2, y + 12 + u * 13)
      const ledCol = u % 2 === 0 ? 0x22c55e : 0xfbbf24
      g.fillStyle(ledCol, 0.9)
      g.fillCircle(x + w - 6, y + 7 + u * 13, 2)
      g.fillStyle(0x22d3ee, 0.2)
      g.fillRect(x + 4, y + 8 + u * 13, w - 14, 3)
    }
  }

  private drawBriefingRoom(g: Phaser.GameObjects.Graphics) {
    const { x, y, w, h } = AGENT_ROOMS.briefing
    g.fillStyle(0x111c33, 1)
    g.fillRect(x, y, w, h)
    g.fillStyle(0x6366f1, 0.06)
    g.fillRoundedRect(x + 20, y + 24, w - 40, h - 48, 8)
    // Round table
    const cx = x + w / 2, cy = y + h / 2
    g.fillStyle(0x000000, 0.25)
    g.fillEllipse(cx + 3, cy + 4, 110, 70)
    g.fillStyle(0x1e1b4b, 1)
    g.fillEllipse(cx, cy, 110, 70)
    g.lineStyle(2, 0x4338ca, 1)
    g.strokeEllipse(cx, cy, 110, 70)
    g.fillStyle(0xa78bfa, 0.4)
    g.fillEllipse(cx, cy, 60, 24)
    // Chairs
    const seats: Array<[number, number, boolean]> = [
      [cx, cy - 48, false], [cx, cy + 48, false],
      [cx - 70, cy, true], [cx + 70, cy, true],
    ]
    seats.forEach(([sx, sy, rot]) => {
      const cw = rot ? 22 : 28, ch = rot ? 28 : 22
      g.fillStyle(0x1e1b4b, 1)
      g.fillRoundedRect(sx - cw / 2, sy - ch / 2, cw, ch, 5)
      g.lineStyle(1, 0x4338ca, 1)
      g.strokeRoundedRect(sx - cw / 2, sy - ch / 2, cw, ch, 5)
    })
    // Wall holo-display
    g.fillStyle(0x000d1a, 1)
    g.fillRoundedRect(x + w / 2 - 36, y + 8, 72, 32, 3)
    g.lineStyle(1, 0xa78bfa, 0.7)
    g.strokeRoundedRect(x + w / 2 - 36, y + 8, 72, 32, 3)
    g.fillStyle(0xa78bfa, 0.4)
    g.fillRect(x + w / 2 - 34, y + 12, 68, 22)
  }

  private drawNeuralCore(g: Phaser.GameObjects.Graphics) {
    const { x, y, w, h } = AGENT_ROOMS.neural_core
    g.fillStyle(0x0a0f24, 1)
    g.fillRect(x, y, w, h)

    // Hex grid
    g.lineStyle(0.5, 0xa78bfa, 0.15)
    for (let gx = x + T; gx < x + w; gx += T) g.lineBetween(gx, y, gx, y + h)
    for (let gy = y + T; gy < y + h; gy += T) g.lineBetween(x, gy, x + w, gy)

    // Central core column
    const cx = x + w / 2, cy = y + h / 2
    g.fillStyle(0x000d1a, 1)
    g.fillRoundedRect(cx - 60, cy - 140, 120, 280, 8)
    g.lineStyle(2, 0xec4899, 0.8)
    g.strokeRoundedRect(cx - 60, cy - 140, 120, 280, 8)
    // Pulsing nucleus
    g.fillStyle(0xa78bfa, 0.6)
    g.fillCircle(cx, cy, 40)
    g.fillStyle(0xec4899, 0.4)
    g.fillCircle(cx, cy, 28)
    g.fillStyle(0xfbbf24, 0.95)
    g.fillCircle(cx, cy, 14)
    // Energy lines
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      g.lineStyle(1.5, 0xec4899, 0.5)
      g.lineBetween(cx + Math.cos(a) * 50, cy + Math.sin(a) * 50, cx + Math.cos(a) * 90, cy + Math.sin(a) * 90)
    }

    // Side terminals
    const terms = [
      { tx: x + 30, ty: y + 30 },
      { tx: x + 30, ty: y + h - 100 },
      { tx: x + w - 96, ty: y + 30 },
      { tx: x + w - 96, ty: y + h - 100 },
    ]
    terms.forEach(({ tx, ty }) => {
      g.fillStyle(0x000d1a, 1)
      g.fillRoundedRect(tx, ty, 70, 50, 4)
      g.lineStyle(1, 0x22d3ee, 0.7)
      g.strokeRoundedRect(tx, ty, 70, 50, 4)
      g.fillStyle(0x22d3ee, 0.7)
      g.fillRect(tx + 6, ty + 8, 50, 2)
      g.fillStyle(0x22d3ee, 0.4)
      g.fillRect(tx + 6, ty + 14, 40, 2)
      g.fillRect(tx + 6, ty + 20, 56, 2)
      g.fillStyle(0xec4899, 0.6)
      g.fillRect(tx + 6, ty + 30, 30, 2)
      g.fillStyle(0xfbbf24, 0.7)
      g.fillCircle(tx + 60, ty + 38, 4)
    })

    // Frame
    g.lineStyle(2, 0xec4899, 0.3)
    g.strokeRect(x + 4, y + 4, w - 8, h - 8)
  }

  // ──────────────────────────────────────────────────────────────
  // WALLS
  // ──────────────────────────────────────────────────────────────
  private drawWall(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number) {
    g.lineStyle(6, 0xffffff, 1)
    g.lineBetween(x1, y1, x2, y2)
    g.lineStyle(1, 0x000000, 0.1)
    if (y1 === y2) g.lineBetween(x1, y1 + 3, x2, y2 + 3)
    else g.lineBetween(x1 + 3, y1, x2 + 3, y2)
  }

  private drawMainFloorWalls(g: Phaser.GameObjects.Graphics) {
    const doorGap = 56

    // Corner Office — all 4 walls, door on left
    const co = MAIN_ROOMS.corner_office
    const coDoorY = co.y + co.h / 2
    this.drawWall(g, co.x, co.y, co.x + co.w, co.y) // top
    this.drawWall(g, co.x, co.y + co.h, co.x + co.w, co.y + co.h) // bottom
    this.drawWall(g, co.x + co.w, co.y, co.x + co.w, co.y + co.h) // right
    this.drawWall(g, co.x, co.y, co.x, coDoorY - doorGap / 2) // left top half
    this.drawWall(g, co.x, coDoorY + doorGap / 2, co.x, co.y + co.h) // left bottom half

    // Breakout 2 — all walls except left has door
    const b2 = MAIN_ROOMS.breakout_2
    const b2DoorY = b2.y + b2.h / 2
    this.drawWall(g, b2.x, b2.y, b2.x + b2.w, b2.y)
    this.drawWall(g, b2.x, b2.y + b2.h, b2.x + b2.w, b2.y + b2.h)
    this.drawWall(g, b2.x + b2.w, b2.y, b2.x + b2.w, b2.y + b2.h)
    this.drawWall(g, b2.x, b2.y, b2.x, b2DoorY - doorGap / 2)
    this.drawWall(g, b2.x, b2DoorY + doorGap / 2, b2.x, b2.y + b2.h)

    // Center Meeting — all 4 walls with doors
    const mt = MAIN_ROOMS.center_meeting
    const mtCX = mt.x + mt.w / 2, mtCY = mt.y + mt.h / 2
    this.drawWall(g, mt.x, mt.y, mtCX - doorGap / 2, mt.y)
    this.drawWall(g, mtCX + doorGap / 2, mt.y, mt.x + mt.w, mt.y)
    this.drawWall(g, mt.x, mt.y + mt.h, mtCX - doorGap / 2, mt.y + mt.h)
    this.drawWall(g, mtCX + doorGap / 2, mt.y + mt.h, mt.x + mt.w, mt.y + mt.h)
    this.drawWall(g, mt.x, mt.y, mt.x, mtCY - doorGap / 2)
    this.drawWall(g, mt.x, mtCY + doorGap / 2, mt.x, mt.y + mt.h)
    this.drawWall(g, mt.x + mt.w, mt.y, mt.x + mt.w, mtCY - doorGap / 2)
    this.drawWall(g, mt.x + mt.w, mtCY + doorGap / 2, mt.x + mt.w, mt.y + mt.h)

    // Breakout 1 — top, bottom, right; left open to stairwell side
    const b1 = MAIN_ROOMS.breakout_1
    const b1DoorY = b1.y + b1.h / 2
    this.drawWall(g, b1.x, b1.y, b1.x + b1.w, b1.y)
    this.drawWall(g, b1.x, b1.y + b1.h, b1.x + b1.w, b1.y + b1.h)
    this.drawWall(g, b1.x + b1.w, b1.y, b1.x + b1.w, b1DoorY - doorGap / 2)
    this.drawWall(g, b1.x + b1.w, b1DoorY + doorGap / 2, b1.x + b1.w, b1.y + b1.h)

    // Open Plan — top wall (against building edge) + bottom wall (separating from breakout/meeting area)
    const op = MAIN_ROOMS.open_plan
    this.drawWall(g, op.x, op.y, op.x + op.w, op.y)
    // Bottom wall with gap to allow flow downward
    const opDoorX = op.x + op.w / 2
    this.drawWall(g, op.x, op.y + op.h, opDoorX - doorGap / 2, op.y + op.h)
    this.drawWall(g, opDoorX + doorGap / 2, op.y + op.h, op.x + op.w, op.y + op.h)

    // Lounge — top wall (separates from breakout/meeting), bottom wall
    const lo = MAIN_ROOMS.lounge
    this.drawWall(g, lo.x, lo.y, lo.x + lo.w, lo.y)
    this.drawWall(g, lo.x, lo.y + lo.h, lo.x + lo.w, lo.y + lo.h)

    // Outer building walls (top, bottom, sides) — across the working area
    this.drawWall(g, T*4, 0, MAP_WIDTH * T, 0) // top
    this.drawWall(g, T*4, MAP_HEIGHT * T, MAP_WIDTH * T, MAP_HEIGHT * T) // bottom
    this.drawWall(g, MAP_WIDTH * T, 0, MAP_WIDTH * T, MAP_HEIGHT * T) // right

    // Stairwell separation (right wall of stairwell)
    this.drawWall(g, T*4, 0, T*4, MAP_HEIGHT * T)
  }

  private drawAgentFloorWalls(g: Phaser.GameObjects.Graphics) {
    const doorGap = 56

    const ah = AGENT_ROOMS.agent_hub
    this.drawWall(g, ah.x, ah.y, ah.x + ah.w, ah.y)
    this.drawWall(g, ah.x, ah.y + ah.h, ah.x + ah.w / 3 - doorGap / 2, ah.y + ah.h)
    this.drawWall(g, ah.x + ah.w / 3 + doorGap / 2, ah.y + ah.h, ah.x + ah.w * 2 / 3 - doorGap / 2, ah.y + ah.h)
    this.drawWall(g, ah.x + ah.w * 2 / 3 + doorGap / 2, ah.y + ah.h, ah.x + ah.w, ah.y + ah.h)

    const sr = AGENT_ROOMS.server_room
    this.drawWall(g, sr.x, sr.y + sr.h, sr.x + sr.w, sr.y + sr.h)
    this.drawWall(g, sr.x + sr.w, sr.y, sr.x + sr.w, sr.y + sr.h)

    const br = AGENT_ROOMS.briefing
    this.drawWall(g, br.x, br.y, br.x, br.y + br.h)
    this.drawWall(g, br.x + br.w, br.y, br.x + br.w, br.y + br.h)
    this.drawWall(g, br.x, br.y + br.h, br.x + br.w, br.y + br.h)

    const nc = AGENT_ROOMS.neural_core
    const ncDoorY = nc.y + nc.h / 2
    this.drawWall(g, nc.x, nc.y, nc.x + nc.w, nc.y)
    this.drawWall(g, nc.x, nc.y + nc.h, nc.x + nc.w, nc.y + nc.h)
    this.drawWall(g, nc.x + nc.w, nc.y, nc.x + nc.w, nc.y + nc.h)
    this.drawWall(g, nc.x, nc.y, nc.x, ncDoorY - doorGap / 2)
    this.drawWall(g, nc.x, ncDoorY + doorGap / 2, nc.x, nc.y + nc.h)

    // Outer building walls
    this.drawWall(g, T*4, 0, MAP_WIDTH * T, 0)
    this.drawWall(g, T*4, MAP_HEIGHT * T, MAP_WIDTH * T, MAP_HEIGHT * T)
    this.drawWall(g, MAP_WIDTH * T, 0, MAP_WIDTH * T, MAP_HEIGHT * T)
    this.drawWall(g, T*4, 0, T*4, MAP_HEIGHT * T)
  }

  // ──────────────────────────────────────────────────────────────
  // DOORS
  // ──────────────────────────────────────────────────────────────
  private setupDoors() {
    this.doorSystem = new DoorSystem(this, (roomId, locked) => {
      this.emitter.emit('doorLocked', { roomId, locked })
    })

    if (this.sceneData.floor === 'main') {
      const co = MAIN_ROOMS.corner_office, mt = MAIN_ROOMS.center_meeting, b1 = MAIN_ROOMS.breakout_1, b2 = MAIN_ROOMS.breakout_2, op = MAIN_ROOMS.open_plan
      this.doorSystem.add({ id: 'co_door',    roomId: 'corner_office',  wx: co.x, wy: co.y + co.h / 2, orientation: 'v', state: 'open' })
      this.doorSystem.add({ id: 'mt_north',   roomId: 'center_meeting', wx: mt.x + mt.w / 2, wy: mt.y, orientation: 'h', state: 'open' })
      this.doorSystem.add({ id: 'mt_south',   roomId: 'center_meeting', wx: mt.x + mt.w / 2, wy: mt.y + mt.h, orientation: 'h', state: 'open' })
      this.doorSystem.add({ id: 'mt_west',    roomId: 'center_meeting', wx: mt.x, wy: mt.y + mt.h / 2, orientation: 'v', state: 'open' })
      this.doorSystem.add({ id: 'mt_east',    roomId: 'center_meeting', wx: mt.x + mt.w, wy: mt.y + mt.h / 2, orientation: 'v', state: 'open' })
      this.doorSystem.add({ id: 'b1_door',    roomId: 'breakout_1',     wx: b1.x + b1.w, wy: b1.y + b1.h / 2, orientation: 'v', state: 'open' })
      this.doorSystem.add({ id: 'b2_door',    roomId: 'breakout_2',     wx: b2.x, wy: b2.y + b2.h / 2, orientation: 'v', state: 'open' })
      this.doorSystem.add({ id: 'op_door',    roomId: 'open_plan',      wx: op.x + op.w / 2, wy: op.y + op.h, orientation: 'h', state: 'open' })
    } else {
      const nc = AGENT_ROOMS.neural_core, ah = AGENT_ROOMS.agent_hub
      this.doorSystem.add({ id: 'nc_door',     roomId: 'neural_core',   wx: nc.x, wy: nc.y + nc.h / 2, orientation: 'v', state: 'open' })
      this.doorSystem.add({ id: 'sr_door',     roomId: 'server_room',   wx: ah.x + ah.w / 3, wy: ah.y + ah.h, orientation: 'h', state: 'open' })
      this.doorSystem.add({ id: 'br_door',     roomId: 'briefing_room', wx: ah.x + ah.w * 2 / 3, wy: ah.y + ah.h, orientation: 'h', state: 'open' })
    }
  }

  // ──────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────
  private addLabel(text: string, x: number, y: number, color: string, bg: string) {
    this.add.text(x, y, text, {
      fontSize: '12px',
      fontFamily: '"Segoe UI", Arial, sans-serif',
      fontStyle: 'bold',
      color,
      backgroundColor: bg,
      padding: { x: 8, y: 3 },
    }).setOrigin(0.5, 0).setAlpha(0.92)
  }

  private drawDesk(g: Phaser.GameObjects.Graphics, x: number, y: number, facingSouth: boolean) {
    const dw = 70, dh = 36
    g.fillStyle(0x000000, 0.11)
    g.fillRoundedRect(x + 3, y + 4, dw, dh, 3)
    g.fillStyle(0x6b4423, 1)
    g.fillRoundedRect(x, y, dw, dh, 3)
    g.fillStyle(0x8a5c30, 0.5)
    g.fillRoundedRect(x + 2, y + 2, dw - 4, 11, 2)
    g.lineStyle(1.5, 0x3a2010, 1)
    g.strokeRoundedRect(x, y, dw, dh, 3)
    const my = facingSouth ? y + 4 : y + dh - 24
    g.fillStyle(0x000000, 0.12)
    g.fillRoundedRect(x + 16, my + 3, 40, 20, 2)
    g.fillStyle(0x0c0c14, 1)
    g.fillRoundedRect(x + 14, my, 40, 20, 2)
    g.fillStyle(0x2563eb, 1)
    g.fillRoundedRect(x + 16, my + 2, 36, 14, 2)
    g.fillStyle(0x60a5fa, 0.3)
    g.fillRect(x + 16, my + 2, 36, 6)
    const cy = facingSouth ? y + dh + 6 : y - 32
    g.fillStyle(0x000000, 0.1)
    g.fillRoundedRect(x + 16, cy + 3, 36, 24, 4)
    g.fillStyle(0x263347, 1)
    g.fillRoundedRect(x + 14, cy, 36, 24, 4)
    g.lineStyle(1, 0x3d5169, 1)
    g.strokeRoundedRect(x + 14, cy, 36, 24, 4)
    g.fillStyle(0x3d5169, 0.6)
    g.fillRoundedRect(x + 18, cy + 3, 28, 8, 3)
  }

  private drawPlant(g: Phaser.GameObjects.Graphics, px: number, py: number, r = 12) {
    g.fillStyle(0x000000, 0.14)
    g.fillEllipse(px + 3, py + 13, 20, 6)
    g.fillStyle(0x8b5a2b, 1)
    g.fillRoundedRect(px - 8, py, 16, 11, 2)
    g.fillStyle(0x6b4020, 0.55)
    g.fillRoundedRect(px - 6, py + 2, 12, 5, 2)
    g.lineStyle(1, 0x4a2810, 1)
    g.strokeRoundedRect(px - 8, py, 16, 11, 2)
    g.fillStyle(0x000000, 0.08)
    g.fillCircle(px + 2, py - r + 2, r)
    g.fillStyle(0x15803d, 1)
    g.fillCircle(px, py - r, r)
    g.fillCircle(px - r * 0.6, py - r * 0.58, r * 0.7)
    g.fillCircle(px + r * 0.6, py - r * 0.58, r * 0.7)
    g.fillStyle(0x22c55e, 0.5)
    g.fillCircle(px - r * 0.18, py - r - 2, r * 0.44)
    g.fillStyle(0x4ade80, 0.38)
    g.fillCircle(px - r * 0.35, py - r * 1.28, r * 0.2)
  }

  // ──────────────────────────────────────────────────────────────
  // SCENE SETUP
  // ──────────────────────────────────────────────────────────────
  private spawnLocalPlayer() {
    let sx: number, sy: number
    if (this.sceneData.spawnAtStairwell) {
      const sw = this.sceneData.floor === 'agent' ? AGENT_ROOMS.stairwell : MAIN_ROOMS.stairwell
      sx = sw.x + sw.w / 2
      sy = this.sceneData.floor === 'agent' ? sw.y + 20 : sw.y + sw.h - 20
      this.stairwellArmed = false
      this.stairwellTimer = -2000
    } else {
      const start = this.sceneData.floor === 'agent' ? AGENT_ROOMS.agent_hub : MAIN_ROOMS.open_plan
      sx = start.x + start.w / 2
      sy = start.y + start.h / 2
    }

    this.localPlayer = new PlayerAvatar(
      this, sx, sy,
      this.sceneData.userId,
      this.sceneData.displayName,
      this.sceneData.avatarIndex,
      true,
      this.sceneData.avatarUrl ?? null,
    )
  }

  private setupCamera() {
    const W = MAP_WIDTH * T
    const H = MAP_HEIGHT * T
    this.cameras.main.setBounds(0, 0, W, H)
    this.cameras.main.setZoom(0.7)
    this.cameras.main.centerOn(this.localPlayer.x, this.localPlayer.y)
  }

  private setupInput() {
    const roomBounds = getRoomPixelBounds(this.sceneData.floor)
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
      if (pointer.button !== 0) return
      // Suppress player move while decorating, or when clicking on any interactive object (door, decoration)
      if (this.decorateMode) return
      if (currentlyOver && currentlyOver.length > 0) return
      if (this.doorSystem.isPointBlocked(pointer.worldX, pointer.worldY, roomBounds)) return
      this.localPlayer.moveToPoint(pointer.worldX, pointer.worldY)
    })

    if (this.input.keyboard) {
      this.wasd = {
        w: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        a: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        s: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      }
    }
  }

  private setupPresence() {
    const channelName = `office_${this.sceneData.floor}`
    const channel = this.sceneData.supabaseClient.channel(channelName, {
      config: { presence: { key: this.sceneData.userId } },
    })

    this.presenceSystem = new PresenceSystem(channel, (presences) => {
      this.emitter.emit('presenceUpdate', presences)
      this.syncRemotePlayers(presences)
    })

    this.presenceSystem.start({
      userId: this.sceneData.userId,
      displayName: this.sceneData.displayName,
      x: this.localPlayer.x,
      y: this.localPlayer.y,
      roomId: this.currentRoomId,
      division: this.sceneData.division,
      avatarIndex: this.sceneData.avatarIndex,
      avatarUrl: this.sceneData.avatarUrl ?? null,
    })
  }

  private handleSceneDecorateMode = (enabled: boolean) => {
    this.decorateMode = enabled
  }

  private listenEmitter() {
    this.emitter.on('lockRoom', ({ roomId, locked }) => {
      this.doorSystem.setRoomLocked(roomId, locked)
    })
    this.emitter.on('windowViewChange', (view: WindowView) => {
      if (this.sceneData.floor === 'main') this.drawWindowScene(view)
    })
    this.emitter.on('setDecorateMode', this.handleSceneDecorateMode)
  }

  // ──────────────────────────────────────────────────────────────
  // GAME LOOP
  // ──────────────────────────────────────────────────────────────
  update(_time: number, delta: number) {
    this.localPlayer.update(delta)
    for (const uid of Object.keys(this.remotePlayers)) this.remotePlayers[uid].update(delta)

    // WASD
    if (this.wasd) {
      const { w, a, s, d } = this.wasd
      let dx = 0, dy = 0
      if (w.isDown) dy -= 1
      if (s.isDown) dy += 1
      if (a.isDown) dx -= 1
      if (d.isDown) dx += 1
      if (dx !== 0 || dy !== 0) {
        const len = Math.sqrt(dx * dx + dy * dy)
        const spd = 200 * (delta / 1000)
        const nx = Phaser.Math.Clamp(this.localPlayer.x + (dx / len) * spd, 0, MAP_WIDTH * T)
        const ny = Phaser.Math.Clamp(this.localPlayer.y + (dy / len) * spd, 0, MAP_HEIGHT * T)
        this.localPlayer.moveDirectly(nx - this.localPlayer.x, ny - this.localPlayer.y)
        this.wasdActive = true
      } else if (this.wasdActive) {
        this.localPlayer.stopWalking()
        this.wasdActive = false
      }
    }

    // Smooth camera follow
    const cam = this.cameras.main
    cam.scrollX += (this.localPlayer.x - (cam.scrollX + cam.width / 2)) * 0.08
    cam.scrollY += (this.localPlayer.y - (cam.scrollY + cam.height / 2)) * 0.08

    // Room detection
    const newRoom = this.detectRoom(this.localPlayer.x, this.localPlayer.y)
    if (newRoom !== this.currentRoomId) {
      this.currentRoomId = newRoom
      this.emitter.emit('roomChange', newRoom)
    }

    // Stairwell entry detection (with 800ms dwell time to prevent accidental triggers)
    this.detectStairwell(delta)

    // 10 Hz position broadcasting
    this.posEmitTimer += delta
    if (this.posEmitTimer >= 100) {
      this.posEmitTimer = 0
      this.presenceSystem?.updatePosition(this.localPlayer.x, this.localPlayer.y, this.currentRoomId)
      this.emitter.emit('positionUpdate', {
        x: this.localPlayer.x,
        y: this.localPlayer.y,
        worldX: this.localPlayer.x,
        worldY: this.localPlayer.y,
        scrollX: cam.scrollX,
        scrollY: cam.scrollY,
        zoom: cam.zoom,
      })
    }

    // 5 Hz proximity broadcast (for Kumospace-style proximity video)
    this.proximityTimer += delta
    if (this.proximityTimer >= 200) {
      this.proximityTimer = 0
      this.emitProximity()
    }
  }

  private emitProximity() {
    const PROX_RADIUS = 220
    const events: { userId: string; distance: number; inAudioZone: boolean }[] = []
    const lx = this.localPlayer.x, ly = this.localPlayer.y
    const myRoom = this.currentRoomId
    for (const uid of Object.keys(this.remotePlayers)) {
      const r = this.remotePlayers[uid]
      const dx = r.x - lx, dy = r.y - ly
      const dist = Math.sqrt(dx * dx + dy * dy)
      // In audio zone if in the same private room (meeting, breakout, corner office)
      const myRoomData = MAIN_FLOOR_ROOMS.find((rm) => rm.name === myRoom) || AGENT_FLOOR_ROOMS.find((rm) => rm.name === myRoom)
      const isPrivate = !!myRoomData && (myRoom === 'center_meeting' || myRoom === 'corner_office' || myRoom === 'breakout_1' || myRoom === 'breakout_2' || myRoom === 'briefing_room' || myRoom === 'server_room' || myRoom === 'neural_core')
      const remoteRoom = this.detectRoom(r.x, r.y)
      const inAudioZone = isPrivate && remoteRoom === myRoom
      if (dist < PROX_RADIUS || inAudioZone) {
        events.push({ userId: uid, distance: dist, inAudioZone })
      }
    }
    this.emitter.emit('proximityUpdate', events)
  }

  private detectStairwell(delta: number) {
    const sw = this.sceneData.floor === 'agent' ? AGENT_ROOMS.stairwell : MAIN_ROOMS.stairwell
    const inside = this.localPlayer.x >= sw.x && this.localPlayer.x <= sw.x + sw.w
                && this.localPlayer.y >= sw.y && this.localPlayer.y <= sw.y + sw.h
    if (!inside) {
      this.stairwellTimer = 0
      this.stairwellArmed = true
      return
    }
    if (!this.stairwellArmed) return
    this.stairwellTimer += delta
    if (this.stairwellTimer >= 700) {
      this.stairwellArmed = false
      this.emitter.emit('floorTransition', this.sceneData.floor === 'main' ? 'agent' : 'main')
    }
  }

  private syncRemotePlayers(presences: Record<string, PresencePayload>) {
    const seen = new Set<string>()
    for (const key of Object.keys(presences)) {
      const p = presences[key]
      if (p.userId === this.sceneData.userId) continue
      seen.add(p.userId)
      if (!this.remotePlayers[p.userId]) {
        this.remotePlayers[p.userId] = new PlayerAvatar(
          this, p.x, p.y, p.userId, p.displayName, p.avatarIndex, false, p.avatarUrl ?? null
        )
      } else {
        this.remotePlayers[p.userId].moveToPoint(p.x, p.y)
      }
    }
    for (const uid of Object.keys(this.remotePlayers)) {
      if (!seen.has(uid)) {
        this.remotePlayers[uid].destroy()
        delete this.remotePlayers[uid]
      }
    }
  }

  private detectRoom(worldX: number, worldY: number): string | null {
    const tx = worldX / T
    const ty = worldY / T
    const rooms = this.sceneData.floor === 'agent' ? AGENT_FLOOR_ROOMS : MAIN_FLOOR_ROOMS
    for (const room of rooms) {
      if (tx >= room.x1 && tx <= room.x2 && ty >= room.y1 && ty <= room.y2) return room.name
    }
    return null
  }

  private cleanedUp = false
  cleanup() {
    if (this.cleanedUp) return
    this.cleanedUp = true
    this.presenceSystem?.stop()
    this.doorSystem?.destroy()
    this.decorationSystem?.destroy()
    // Players hold off-display-list mask graphics that need explicit cleanup
    this.localPlayer?.destroy()
    for (const uid of Object.keys(this.remotePlayers)) this.remotePlayers[uid].destroy()
    this.remotePlayers = {}
    this.emitter.off('lockRoom')
    this.emitter.off('windowViewChange')
    this.emitter.off('setDecorateMode', this.handleSceneDecorateMode)
  }
}

function centerX(rect: { x: number; w: number }) { return rect.x + rect.w / 2 }
