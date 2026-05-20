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
  // Focus events
  focusUpdate: { focusMode: boolean; focusTask: string; focusEndsAt: number | null }
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
  private roomBounds!: Array<{ name: string; px1: number; py1: number; px2: number; py2: number }>

  constructor() {
    super({ key: 'OfficeScene' })
  }

  init(data: OfficeSceneData) {
    if (!data || !data.emitter) {
      console.error('[OfficeScene] init called without sceneData.emitter — Phaser scene boot race', data)
      // Don't crash; scene will be restarted by the proper flow
      return
    }
    this.sceneData = { ...data, floor: data.floor ?? 'main', windowView: data.windowView ?? 'city_day' }
    this.emitter = data.emitter
    this.currentRoomId = null
    this.remotePlayers = {}
  }

  create() {
    if (!this.sceneData || !this.emitter) {
      console.warn('[OfficeScene] create skipped — sceneData not yet set')
      return
    }
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

    // Base corridor floor — clean warm stone tiles (Kumospace style)
    const bx = T * 4, bw = T * 48, bh = T * 30
    const tileSize = 48
    for (let gy = 0; gy < bh; gy += tileSize) {
      for (let gx = bx; gx < bx + bw; gx += tileSize) {
        const isAlt = (((gx - bx) / tileSize | 0) + (gy / tileSize | 0)) % 2 === 0
        g.fillStyle(isAlt ? 0xe8e5de : 0xe2dfd8, 1)
        g.fillRect(gx, gy, Math.min(tileSize - 1, bx + bw - gx), Math.min(tileSize - 1, bh - gy))
      }
    }
    // Tile grout lines
    g.lineStyle(1, 0xd0ccc4, 0.6)
    for (let gy = 0; gy < bh; gy += tileSize) g.lineBetween(bx, gy, bx + bw, gy)
    for (let gx = bx; gx < bx + bw; gx += tileSize) g.lineBetween(gx, 0, gx, bh)

    // Draw each room on top of base floor
    this.drawStairwell(g, MAIN_ROOMS.stairwell, 'down')
    this.drawOpenPlan(g)
    this.drawBreakout(g, MAIN_ROOMS.breakout_1, 'mint')
    this.drawCenterMeeting(g)
    this.drawLounge(g)
    this.drawCornerOfficeBase(g)  // window area gets dark sky placeholder
    this.drawBreakout(g, MAIN_ROOMS.breakout_2, 'lavender')

    // Colored glow bleed from each room's doorway into the corridor
    // Soft ellipses centered on door thresholds — room color seeps into corridor
    g.fillStyle(0x4f46e5, 0.1);  g.fillEllipse(MAIN_ROOMS.open_plan.x + MAIN_ROOMS.open_plan.w / 2, MAIN_ROOMS.open_plan.y + MAIN_ROOMS.open_plan.h, 100, 48)
    g.fillStyle(0x0284c7, 0.1);  g.fillEllipse(MAIN_ROOMS.center_meeting.x + MAIN_ROOMS.center_meeting.w / 2, MAIN_ROOMS.center_meeting.y, 100, 48)
    g.fillStyle(0x0284c7, 0.08); g.fillEllipse(MAIN_ROOMS.center_meeting.x + MAIN_ROOMS.center_meeting.w / 2, MAIN_ROOMS.center_meeting.y + MAIN_ROOMS.center_meeting.h, 100, 48)
    g.fillStyle(0x0284c7, 0.08); g.fillEllipse(MAIN_ROOMS.center_meeting.x, MAIN_ROOMS.center_meeting.y + MAIN_ROOMS.center_meeting.h / 2, 48, 100)
    g.fillStyle(0x0284c7, 0.08); g.fillEllipse(MAIN_ROOMS.center_meeting.x + MAIN_ROOMS.center_meeting.w, MAIN_ROOMS.center_meeting.y + MAIN_ROOMS.center_meeting.h / 2, 48, 100)
    g.fillStyle(0x16a34a, 0.1);  g.fillEllipse(MAIN_ROOMS.breakout_1.x + MAIN_ROOMS.breakout_1.w, MAIN_ROOMS.breakout_1.y + MAIN_ROOMS.breakout_1.h / 2, 48, 100)
    g.fillStyle(0x7c3aed, 0.1);  g.fillEllipse(MAIN_ROOMS.breakout_2.x, MAIN_ROOMS.breakout_2.y + MAIN_ROOMS.breakout_2.h / 2, 48, 100)
    g.fillStyle(0xd97706, 0.1);  g.fillEllipse(MAIN_ROOMS.corner_office.x, MAIN_ROOMS.corner_office.y + MAIN_ROOMS.corner_office.h / 2, 48, 100)

    // Walls + door gaps
    this.drawMainFloorWalls(g)

    // Colored entry strips at each door opening (Kumospace signature)
    const doorGap = 56
    // Open Plan door (south wall)
    const op = MAIN_ROOMS.open_plan
    g.fillStyle(0x4f46e5, 0.35)
    g.fillRect(op.x + op.w / 2 - doorGap / 2, op.y + op.h - 4, doorGap, 8)
    // Center Meeting doors (north, south, west, east)
    const mt = MAIN_ROOMS.center_meeting
    g.fillStyle(0x0284c7, 0.35)
    g.fillRect(mt.x + mt.w / 2 - doorGap / 2, mt.y - 4, doorGap, 8)
    g.fillRect(mt.x + mt.w / 2 - doorGap / 2, mt.y + mt.h - 4, doorGap, 8)
    g.fillRect(mt.x - 4, mt.y + mt.h / 2 - doorGap / 2, 8, doorGap)
    g.fillRect(mt.x + mt.w - 4, mt.y + mt.h / 2 - doorGap / 2, 8, doorGap)
    // Breakout 1 door (right wall)
    const b1 = MAIN_ROOMS.breakout_1
    g.fillStyle(0x16a34a, 0.35)
    g.fillRect(b1.x + b1.w - 4, b1.y + b1.h / 2 - doorGap / 2, 8, doorGap)
    // Breakout 2 door (left wall)
    const b2 = MAIN_ROOMS.breakout_2
    g.fillStyle(0x7c3aed, 0.35)
    g.fillRect(b2.x - 4, b2.y + b2.h / 2 - doorGap / 2, 8, doorGap)
    // Corner Office door (left wall)
    const co = MAIN_ROOMS.corner_office
    g.fillStyle(0xd97706, 0.35)
    g.fillRect(co.x - 4, co.y + co.h / 2 - doorGap / 2, 8, doorGap)

    // Coffee station in corridor (Kumospace-style watercooler area)
    const csX = T * 24, csY = T * 10
    // Counter
    g.fillStyle(0x000000, 0.1)
    g.fillRoundedRect(csX + 2, csY + 3, 52, 28, 4)
    g.fillStyle(0xf1f5f9, 1)
    g.fillRoundedRect(csX, csY, 52, 28, 4)
    g.lineStyle(1.5, 0xcbd5e1, 1)
    g.strokeRoundedRect(csX, csY, 52, 28, 4)
    // Coffee machine body
    g.fillStyle(0x1e293b, 1)
    g.fillRoundedRect(csX + 4, csY + 4, 20, 20, 3)
    g.fillStyle(0x0ea5e9, 0.7)
    g.fillRoundedRect(csX + 6, csY + 6, 16, 10, 2)
    g.fillStyle(0xfbbf24, 1)
    g.fillCircle(csX + 14, csY + 20, 4)
    // Water cooler
    g.fillStyle(0xbfdbfe, 0.9)
    g.fillRoundedRect(csX + 30, csY + 2, 16, 24, 4)
    g.fillStyle(0x60a5fa, 0.4)
    g.fillRoundedRect(csX + 32, csY + 4, 12, 10, 2)
    g.lineStyle(1, 0x3b82f6, 0.6)
    g.strokeRoundedRect(csX + 30, csY + 2, 16, 24, 4)
    // Coffee cups
    g.fillStyle(0xfef9c3, 1)
    g.fillCircle(csX + 9,  csY + 32, 4)
    g.fillCircle(csX + 20, csY + 32, 4)
    g.fillCircle(csX + 31, csY + 32, 4)
    g.lineStyle(1, 0xfde047, 0.7)
    g.strokeCircle(csX + 9,  csY + 32, 4)
    g.strokeCircle(csX + 20, csY + 32, 4)
    g.strokeCircle(csX + 31, csY + 32, 4)

    // Company branding strip on north wall of corridor
    const brandX = T * 10, brandY = T * 2 - 2, brandW = T * 20, brandH = 18
    g.fillStyle(0x4f46e5, 0.12)
    g.fillRoundedRect(brandX, brandY, brandW, brandH, 3)
    g.lineStyle(1, 0x6366f1, 0.3)
    g.strokeRoundedRect(brandX, brandY, brandW, brandH, 3)

    // Architectural columns at corridor wall-corner intersections (Kumospace style)
    const colPositions: [number, number][] = [
      [T * 4,  T * 12],  // SW corner of open plan
      [T * 22, T * 12],  // SE corner of open plan
      [T * 30, T * 12],  // NW corner of center meeting top-right
      [T * 30, T * 22],  // NE corner of lounge
    ]
    colPositions.forEach(([cx, cy]) => this.drawColumn(g, cx, cy, 9))

    // Reception counter at stairwell exit (welcome area)
    const rcX = T * 5, rcY = T * 13
    g.fillStyle(0x000000, 0.1)
    g.fillRoundedRect(rcX + 2, rcY + 3, 44, 22, 4)
    g.fillStyle(0xf8f3ed, 1)
    g.fillRoundedRect(rcX, rcY, 44, 22, 4)
    g.lineStyle(1.5, 0xd4cdc4, 1)
    g.strokeRoundedRect(rcX, rcY, 44, 22, 4)
    // Reception desk top highlight
    g.fillStyle(0xffffff, 0.6)
    g.fillRoundedRect(rcX + 2, rcY + 2, 40, 6, 3)
    // Chair behind desk
    g.fillStyle(0x374151, 0.9)
    g.fillRoundedRect(rcX + 12, rcY + 26, 20, 16, 4)
    g.fillStyle(0x4b5563, 0.7)
    g.fillRoundedRect(rcX + 14, rcY + 28, 16, 7, 3)

    // Corridor plants — scattered along the central hallway for warmth
    const corridorMidX = T * 22
    const plantPositions: [number, number, number][] = [
      [corridorMidX - 60, T * 5,  11],
      [corridorMidX + 60, T * 5,  10],
      [corridorMidX - 60, T * 14, 12],
      [corridorMidX + 60, T * 14, 11],
      [corridorMidX - 60, T * 23, 10],
      [corridorMidX + 60, T * 23, 12],
    ]
    plantPositions.forEach(([px, py, r]) => this.drawPlant(g, px, py, r))

    // Bake static layout
    g.generateTexture('office_bg', W, H)
    g.destroy()
    this.add.image(0, 0, 'office_bg').setOrigin(0, 0)

    // Live window scene (draws on top of baked texture inside the window rect)
    this.windowGfx = this.add.graphics()
    this.drawWindowScene(this.sceneData.windowView)

    // Branding text over corridor header strip
    const brandCx = T * 10 + T * 10 // center of brandX + brandW/2
    this.add.text(brandCx, T * 2 + 1, 'AGENCY HQ', {
      fontSize: '10px',
      fontFamily: '"Segoe UI", Arial, sans-serif',
      fontStyle: 'bold',
      color: '#6366f1',
    }).setOrigin(0.5, 0).setDepth(2000)

    // Live room labels
    this.addLabel('OPEN PLAN',       centerX(MAIN_ROOMS.open_plan),     MAIN_ROOMS.open_plan.y + 12,     '#1e293b', '#ffffffee')
    this.addLabel('MEETING ROOM',    centerX(MAIN_ROOMS.center_meeting), MAIN_ROOMS.center_meeting.y + 12,'#0c4a6e', '#dbeafeee')
    this.addLabel('BREAKOUT A',      centerX(MAIN_ROOMS.breakout_1),     MAIN_ROOMS.breakout_1.y + 8,     '#14532d', '#dcfce7ee')
    this.addLabel('BREAKOUT B',      centerX(MAIN_ROOMS.breakout_2),     MAIN_ROOMS.breakout_2.y + 8,     '#581c87', '#f3e8ffee')
    this.addLabel('LOUNGE',          centerX(MAIN_ROOMS.lounge),         MAIN_ROOMS.lounge.y + 8,         '#7c2d12', '#fde8d8ee')
    this.addLabel('✦ CORNER OFFICE', centerX(MAIN_ROOMS.corner_office),  MAIN_ROOMS.corner_office.y + 12, '#78350f', '#fef3c7ee')

    // Stairwell indicator (live, blinking)
    this.stairwellLabel = this.add.text(MAIN_ROOMS.stairwell.x + MAIN_ROOMS.stairwell.w / 2, MAIN_ROOMS.stairwell.y + MAIN_ROOMS.stairwell.h / 2, '↓\nAGENT HUB', {
      fontSize: '12px',
      fontFamily: '"Segoe UI", Arial, sans-serif',
      fontStyle: 'bold',
      color: '#fcd34d',
      backgroundColor: '#1f2937dd',
      align: 'center',
      padding: { x: 6, y: 4 },
    }).setOrigin(0.5).setAlpha(0.95).setDepth(2000)
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

    // Live neural core pulse rings (not baked — animated)
    const ncCx = AGENT_ROOMS.neural_core.x + AGENT_ROOMS.neural_core.w / 2
    const ncCy = AGENT_ROOMS.neural_core.y + AGENT_ROOMS.neural_core.h / 2
    const addPulseRing = (delay: number, color: number) => {
      const container = this.add.container(ncCx, ncCy)
      const ring = this.add.graphics()
      ring.lineStyle(2.5, color, 1)
      ring.strokeCircle(0, 0, 44)
      container.add(ring)
      container.setDepth(2)
      this.tweens.add({
        targets: container,
        alpha: { from: 0.75, to: 0 },
        scaleX: { from: 1, to: 3 },
        scaleY: { from: 1, to: 3 },
        delay,
        duration: 2400,
        repeat: -1,
        ease: 'Cubic.easeOut',
      })
    }
    addPulseRing(0, 0xec4899)
    addPulseRing(800, 0xa78bfa)
    addPulseRing(1600, 0x22d3ee)

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
    }).setOrigin(0.5).setAlpha(0.95).setDepth(2000)
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

    // Bright warm oak planks (Kumospace open-workspace style)
    const opPlankH = 16
    const opColors = [0xfdf8ef, 0xf9f2e3, 0xfbf5e8, 0xf6efdf, 0xfcf6ec]
    for (let gy = y; gy < y + h; gy += opPlankH) {
      g.fillStyle(opColors[((gy - y) / opPlankH | 0) % opColors.length], 1)
      g.fillRect(x, gy, w, opPlankH - 1)
      g.fillStyle(0xd4c9b0, 0.35)
      g.fillRect(x, gy + opPlankH - 1, w, 1)
    }
    // Staggered plank end joints
    const opSeamOffs = [0, 55, 110, 30, 80, 140]
    for (let gy = y; gy < y + h; gy += opPlankH) {
      const sOff = opSeamOffs[((gy - y) / opPlankH | 0) % opSeamOffs.length]
      for (let gx = x + sOff; gx < x + w; gx += 140) {
        g.fillStyle(0xd4c9b0, 0.28)
        g.fillRect(gx, gy, 1, opPlankH)
      }
    }
    // Subtle center rug
    g.fillStyle(0xffffff, 0.35)
    g.fillRoundedRect(x + w * 0.18, y + 16, w * 0.64, h - 32, 6)
    this.addRoomDepth(g, x, y, w, h)

    // Desk pods: 3 columns × 2 rows, facing each other across centre aisle
    const deskW = 76
    const colGap = 30
    const cols = 3
    const padX = Math.round((w - cols * deskW - (cols - 1) * colGap) / 2)

    for (let c = 0; c < cols; c++) {
      const px = x + padX + c * (deskW + colGap)
      // Top row — faces south (chairs face into centre aisle)
      this.drawDesk(g, px, y + 36, true)
      // Bottom row — faces north
      this.drawDesk(g, px, y + h - 110, false)
    }

    // Large whiteboard on left wall (Kumospace style)
    const wbX = x + 14, wbY = y + 20, wbW = 110, wbH = 58
    g.fillStyle(0x000000, 0.08)
    g.fillRoundedRect(wbX + 2, wbY + 3, wbW, wbH, 3)
    g.fillStyle(0xf8fafc, 1)
    g.fillRoundedRect(wbX, wbY, wbW, wbH, 3)
    g.lineStyle(2, 0xcbd5e1, 1)
    g.strokeRoundedRect(wbX, wbY, wbW, wbH, 3)
    // Whiteboard frame accent
    g.fillStyle(0x475569, 1)
    g.fillRect(wbX, wbY, wbW, 4)
    // Whiteboard content
    g.lineStyle(2.5, 0x3b82f6, 0.75)
    g.lineBetween(wbX + 10, wbY + 16, wbX + 56, wbY + 20)
    g.lineStyle(2, 0xef4444, 0.6)
    g.lineBetween(wbX + 10, wbY + 28, wbX + 70, wbY + 33)
    g.lineStyle(1.5, 0x22c55e, 0.55)
    g.lineBetween(wbX + 10, wbY + 40, wbX + 50, wbY + 44)
    // Eraser tray
    g.fillStyle(0xdde1e7, 1)
    g.fillRect(wbX + 4, wbY + wbH - 5, wbW - 8, 5)

    // Noticeboard right of whiteboard
    this.drawNoticeboard(g, wbX + wbW + 12, wbY, 64, wbH)

    // Wall art on east wall
    this.drawWallArt(g, x + w - 12, y + (h - 70) / 2, 12, 70, 'abstract')

    // Quick-collab pod: round table + 3 chairs, right side of room
    const cpx = x + w - 120, cpy = y + h / 2
    g.fillStyle(0x000000, 0.1); g.fillEllipse(cpx + 3, cpy + 4, 64, 40)
    g.fillStyle(0xd4c8b0, 1);   g.fillEllipse(cpx, cpy, 64, 40)
    g.fillStyle(0xe8dcc8, 0.6); g.fillEllipse(cpx - 8, cpy - 6, 42, 16)
    g.lineStyle(1.5, 0xb0a080, 0.8); g.strokeEllipse(cpx, cpy, 64, 40)
    // 3 chairs around the pod
    const podSeats: [number, number, boolean][] = [
      [cpx, cpy - 30, false],
      [cpx - 38, cpy + 10, true],
      [cpx + 38, cpy + 10, true],
    ]
    podSeats.forEach(([sx, sy, rot]) => {
      const cw = rot ? 20 : 24, ch = rot ? 24 : 20
      g.fillStyle(0x000000, 0.08); g.fillRoundedRect(sx - cw / 2 + 2, sy - ch / 2 + 3, cw, ch, 4)
      g.fillStyle(0x374151, 1);    g.fillRoundedRect(sx - cw / 2, sy - ch / 2, cw, ch, 4)
      g.fillStyle(0x4b5563, 0.6); g.fillRoundedRect(sx - cw / 2 + 2, sy - ch / 2 + 2, cw - 4, ch * 0.45, 3)
      g.lineStyle(1, 0x4b5563, 0.5); g.strokeRoundedRect(sx - cw / 2, sy - ch / 2, cw, ch, 4)
    })

    // Plants — corners and near walls
    this.drawPlant(g, x + 16,  y + 18,  13)
    this.drawPlant(g, x + w - 18, y + 18, 12)
    this.drawPlant(g, x + 16,  y + h - 18, 11)
    this.drawPlant(g, x + w - 18, y + h - 18, 12)
  }

  private drawBreakout(g: Phaser.GameObjects.Graphics, rect: { x: number; y: number; w: number; h: number }, theme: 'mint' | 'lavender') {
    const { x, y, w, h } = rect
    const isMint = theme === 'mint'

    // Distinctly colored carpet per room — saturated for clear room identity
    const baseColor  = isMint ? 0xbceecd : 0xdacef8
    const weaveColor = isMint ? 0x6bc898 : 0xaa80e8
    const borderColor = isMint ? 0x30a86c : 0x7c42cc
    const rugColor   = isMint ? 0x16a34a : 0x7c3aed

    g.fillStyle(baseColor, 1)
    g.fillRect(x, y, w, h)
    // Carpet weave
    g.lineStyle(0.5, weaveColor, 0.55)
    for (let gy = y + 5; gy < y + h; gy += 5) g.lineBetween(x, gy, x + w, gy)
    g.lineStyle(0.5, weaveColor, 0.35)
    for (let gx = x + 5; gx < x + w; gx += 5) g.lineBetween(gx, y, gx, y + h)
    // Carpet border
    g.fillStyle(borderColor, 0.35)
    g.fillRect(x, y, w, 4)
    g.fillRect(x, y + h - 4, w, 4)
    g.fillRect(x, y, 4, h)
    g.fillRect(x + w - 4, y, 4, h)
    // Rug
    g.fillStyle(rugColor, 0.12)
    g.fillRoundedRect(x + 16, y + 24, w - 32, h - 48, 8)
    this.addRoomDepth(g, x, y, w, h)

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

    // Wall TV — top wall centre
    this.drawWallTV(g, x + w / 2 - 30, y + 8, 60, 32)

    // Plants in all 4 corners
    this.drawPlant(g, x + 16, y + 20, 11)
    this.drawPlant(g, x + w - 16, y + 20, 10)
    this.drawPlant(g, x + 16,  y + h - 18, 10)
    this.drawPlant(g, x + w - 16, y + h - 18, 11)
  }

  private drawCenterMeeting(g: Phaser.GameObjects.Graphics) {
    const { x, y, w, h } = MAIN_ROOMS.center_meeting

    // Rich blue carpet — clearly identifiable
    g.fillStyle(0xa8d4f0, 1)
    g.fillRect(x, y, w, h)
    // Carpet crosshatch texture
    g.lineStyle(0.5, 0xb8d4ea, 0.55)
    for (let gy = y + 6; gy < y + h; gy += 6) g.lineBetween(x, gy, x + w, gy)
    g.lineStyle(0.5, 0xb8d4ea, 0.35)
    for (let gx = x + 6; gx < x + w; gx += 6) g.lineBetween(gx, y, gx, y + h)
    // Carpet border inset
    g.fillStyle(0x90bcd8, 0.5)
    g.fillRect(x, y, w, 4)
    g.fillRect(x, y + h - 4, w, 4)
    g.fillRect(x, y, 4, h)
    g.fillRect(x + w - 4, y, 4, h)
    // Radial rug
    g.fillStyle(0x0ea5e9, 0.14)
    g.fillEllipse(x + w / 2, y + h / 2, w - 20, h - 20)
    g.lineStyle(2, 0x0ea5e9, 0.25)
    g.strokeEllipse(x + w / 2, y + h / 2, w - 30, h - 30)
    this.addRoomDepth(g, x, y, w, h)

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

    // Large wall TV — top wall (conference rooms always have big screens)
    this.drawWallTV(g, x + w / 2 - 46, y + 8, 92, 34)

    // Abstract wall art on left wall
    this.drawWallArt(g, x + 8, y + (h - 60) / 2, 14, 60, 'lines')

    // Noticeboard on right wall
    this.drawNoticeboard(g, x + w - 14, y + (h - 70) / 2, 14, 70)

    // Plants all 4 corners
    this.drawPlant(g, x + 16, y + 16, 13)
    this.drawPlant(g, x + w - 16, y + 16, 12)
    this.drawPlant(g, x + 16, y + h - 16, 12)
    this.drawPlant(g, x + w - 16, y + h - 16, 12)
  }

  private drawLounge(g: Phaser.GameObjects.Graphics) {
    const { x, y, w, h } = MAIN_ROOMS.lounge

    // Warm peach-sand floor (Kumospace lounge style)
    const loPlankH = 16
    const loColors = [0xfde9d2, 0xfae2c6, 0xfcecda, 0xf8ddc0, 0xfbead0]
    for (let gy = y; gy < y + h; gy += loPlankH) {
      g.fillStyle(loColors[((gy - y) / loPlankH | 0) % loColors.length], 1)
      g.fillRect(x, gy, w, loPlankH - 1)
      g.fillStyle(0xd4a870, 0.35)
      g.fillRect(x, gy + loPlankH - 1, w, 1)
    }
    // Staggered end joints
    const loSeamOffs = [0, 60, 120, 40]
    for (let gy = y; gy < y + h; gy += loPlankH) {
      const sOff = loSeamOffs[((gy - y) / loPlankH | 0) % loSeamOffs.length]
      for (let gx = x + sOff; gx < x + w; gx += 120) {
        g.fillStyle(0xd4a870, 0.25)
        g.fillRect(gx, gy, 1, loPlankH)
      }
    }

    this.addRoomDepth(g, x, y, w, h)

    // Big area rug — warm orange tint
    g.fillStyle(0xf97316, 0.12)
    g.fillRoundedRect(x + 28, y + 16, w - 56, h - 32, 10)
    g.lineStyle(1.5, 0xf97316, 0.2)
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

    // Sofas — top and bottom walls, facing the pool table
    this.drawSofa(g, x + 50, y + 14, 120, 30, 0x7f1d1d, true)
    this.drawSofa(g, x + w - 170, y + h - 44, 120, 30, 0x7f1d1d, false)

    // Coffee table between sofas
    g.fillStyle(0x000000, 0.1)
    g.fillRoundedRect(x + 97, y + 47, 54, 22, 4)
    g.fillStyle(0xe8dcc8, 1)
    g.fillRoundedRect(x + 95, y + 45, 54, 22, 4)
    g.lineStyle(1, 0xc4b090, 0.8)
    g.strokeRoundedRect(x + 95, y + 45, 54, 22, 4)

    // Mini-fridge (right wall)
    const fX = x + w - 46, fY = y + h / 2 - 24
    g.fillStyle(0x000000, 0.15)
    g.fillRoundedRect(fX + 3, fY + 4, 30, 48, 3)
    g.fillStyle(0xf1f5f9, 1)
    g.fillRoundedRect(fX, fY, 30, 48, 3)
    g.lineStyle(1.5, 0x94a3b8, 1)
    g.strokeRoundedRect(fX, fY, 30, 48, 3)
    g.lineStyle(1, 0xcbd5e1, 0.8)
    g.lineBetween(fX, fY + 24, fX + 30, fY + 24)
    g.fillStyle(0x64748b, 1)
    g.fillRoundedRect(fX + 24, fY + 6, 3, 10, 2)
    g.fillRoundedRect(fX + 24, fY + 28, 3, 10, 2)

    // Plants — corners + mid walls
    this.drawPlant(g, x + 18, y + 14, 12)
    this.drawPlant(g, x + w - 20, y + 14, 12)
    this.drawPlant(g, x + 18, y + h - 16, 12)
    this.drawPlant(g, x + w - 20, y + h - 16, 11)
  }

  private drawCornerOfficeBase(g: Phaser.GameObjects.Graphics) {
    const { x, y, w, h } = MAIN_ROOMS.corner_office

    // Light warm marble tile floor (premium, bright)
    const coTileW = 48, coTileH = 48
    for (let ty = y; ty < y + h; ty += coTileH) {
      for (let tx = x; tx < x + w; tx += coTileW) {
        const isAlt = (((tx - x) / coTileW | 0) + ((ty - y) / coTileH | 0)) % 2 === 0
        g.fillStyle(isAlt ? 0xf2ede4 : 0xede8de, 1)
        g.fillRect(tx, ty, Math.min(coTileW - 1, x + w - tx), Math.min(coTileH - 1, y + h - ty))
        // Tile grout
        g.fillStyle(0xd8d2c8, 0.7)
        g.fillRect(tx + coTileW - 1, ty, 1, coTileH)
        g.fillRect(tx, ty + coTileH - 1, coTileW, 1)
      }
    }
    // Subtle diagonal veining (warm marble)
    g.lineStyle(0.5, 0xc8c0b4, 0.25)
    for (let d = -h; d < w + h; d += 24) {
      g.lineBetween(
        x + Math.max(0, d), y + Math.max(0, -d),
        x + Math.min(w, d + h), y + Math.min(h, h - d)
      )
    }
    // Soft gold area rug (replacing dark navy carpet)
    g.fillStyle(0xfef3c7, 0.3)
    g.fillRoundedRect(x + 24, y + 16, w - 48, h - 40, 6)
    g.lineStyle(1.5, 0xd97706, 0.25)
    g.strokeRoundedRect(x + 24, y + 16, w - 48, h - 40, 6)
    this.addRoomDepth(g, x, y, w, h)

    // Bookshelf (left wall) — lighter wood to match bright room
    g.fillStyle(0x8b6f47, 1)
    g.fillRect(x + 8, y + 16, 18, h - 36)
    g.lineStyle(1, 0x5c4428, 1)
    g.strokeRect(x + 8, y + 16, 18, h - 36)
    const bc = [0xdc2626, 0x2563eb, 0x16a34a, 0xd97706, 0x7c3aed, 0x0891b2, 0xb45309]
    const shelves = 7
    const sh = (h - 36) / shelves
    for (let s = 0; s < shelves; s++) {
      g.lineStyle(1, 0x5c4428, 0.5)
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
    g.fillStyle(0x000000, 0.1)
    g.fillRoundedRect(credX + 3, credY + 4, credW, credH, 4)
    g.fillStyle(0x6b4f2e, 1)
    g.fillRoundedRect(credX, credY, credW, credH, 4)
    g.fillStyle(0x8a6840, 0.5)
    g.fillRoundedRect(credX + 2, credY + 2, credW - 4, 9, 3)
    g.lineStyle(1.5, 0x4a3020, 1)
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
    g.fillStyle(0x000000, 0.12)
    g.fillRoundedRect(edx + 3, edy + 4, 160, 50, 3)
    g.fillStyle(0x6b4f2e, 1)
    g.fillRoundedRect(edx, edy, 160, 50, 3)
    g.fillRoundedRect(edx, edy, 48, 110, 3)
    g.fillStyle(0x8a6840, 0.5)
    g.fillRoundedRect(edx + 2, edy + 2, 156, 14, 3)
    g.fillRoundedRect(edx + 2, edy + 2, 14, 106, 3)
    g.lineStyle(1.5, 0x4a3020, 1)
    g.strokeRoundedRect(edx, edy, 160, 50, 3)
    g.strokeRoundedRect(edx, edy, 48, 110, 3)
    // Dual monitors on desk
    this.drawWallTV(g, edx + 52, edy + 4, 48, 30)
    this.drawWallTV(g, edx + 106, edy + 4, 48, 30)
    // Laptop on side wing
    g.fillStyle(0x1e293b, 1)
    g.fillRoundedRect(edx + 7, edy + 64, 34, 24, 3)
    g.fillStyle(0x334155, 1)
    g.fillRoundedRect(edx + 9, edy + 66, 30, 18, 2)
    // Exec chair — dark leather
    g.fillStyle(0x000000, 0.16)
    g.fillRoundedRect(edx + 72, edy + 65, 62, 42, 8)
    g.fillStyle(0x1c1c28, 1)
    g.fillRoundedRect(edx + 70, edy + 62, 62, 42, 8)
    g.lineStyle(1.5, 0x374151, 0.7)
    g.strokeRoundedRect(edx + 70, edy + 62, 62, 42, 8)
    g.fillStyle(0x2d3748, 0.8)
    g.fillRoundedRect(edx + 76, edy + 67, 50, 14, 5)
    // Armrests
    g.fillStyle(0x111827, 1)
    g.fillRoundedRect(edx + 70, edy + 67, 7, 18, 2)
    g.fillRoundedRect(edx + 125, edy + 67, 7, 18, 2)

    // Visitor seating area — two chairs + small table near window
    const vaX = x + w - 90, vaY = y + 40
    this.drawSofa(g, vaX, vaY, 70, 26, 0x78350f, true)
    // Small round coffee table
    g.fillStyle(0x000000, 0.12)
    g.fillCircle(vaX + 35, vaY + 52, 18)
    g.fillStyle(0xd4aa60, 1)
    g.fillCircle(vaX + 35, vaY + 50, 18)
    g.fillStyle(0xe8c478, 0.5)
    g.fillCircle(vaX + 30, vaY + 46, 10)
    g.lineStyle(1.5, 0xb08840, 1)
    g.strokeCircle(vaX + 35, vaY + 50, 18)

    // City skyline art above visitor sofa
    this.drawWallArt(g, vaX + 2, vaY + 82, 66, 38, 'city')

    // Abstract art on south wall
    this.drawWallArt(g, x + w / 2 - 30, y + h - 10, 60, 10, 'abstract')

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

    // Plants — multiple for premium feel
    this.drawPlant(g, x + 32, y + h - 38, 14)
    this.drawPlant(g, x + w - 30, y + h - 38, 13)
    this.drawPlant(g, x + w - 30, y + 30, 12)
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
    this.addRoomDepth(g, x, y, w, h)

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
    // Shadow
    g.fillStyle(0x000000, 0.35)
    g.fillRoundedRect(x + 3, y + 4, dw, dh, 3)
    // Desk surface — dark tech tone with cyan edge
    g.fillStyle(0x0f172a, 1)
    g.fillRoundedRect(x, y, dw, dh, 3)
    g.fillStyle(0x1e3a5f, 0.4)
    g.fillRoundedRect(x + 2, y + 2, dw - 4, 8, 2)
    g.lineStyle(1.5, 0x22d3ee, 0.6)
    g.strokeRoundedRect(x, y, dw, dh, 3)
    // Cyan accent strip (power indicator)
    g.fillStyle(0x22d3ee, 0.9)
    g.fillRect(x, y + dh - 3, dw, 3)

    // Monitor bezel
    g.fillStyle(0x020817, 1)
    g.fillRoundedRect(x + 10, y - 20, 44, 24, 2)
    g.lineStyle(1, 0x22d3ee, 0.4)
    g.strokeRoundedRect(x + 10, y - 20, 44, 24, 2)
    // Screen — active terminal content
    g.fillStyle(0x0a1628, 1)
    g.fillRoundedRect(x + 12, y - 18, 40, 20, 2)
    g.fillStyle(0x22d3ee, 0.85)
    g.fillRect(x + 15, y - 14, 28, 2)
    g.fillStyle(0x22d3ee, 0.5)
    g.fillRect(x + 15, y - 9, 34, 2)
    g.fillRect(x + 15, y - 4, 20, 2)
    // Cursor blink
    g.fillStyle(0x22d3ee, 1)
    g.fillRect(x + 36, y - 4, 3, 2)

    // Keyboard glow
    g.fillStyle(0x0c1a30, 1)
    g.fillRoundedRect(x + 14, y + 6, 36, 10, 2)
    g.lineStyle(0.5, 0x22d3ee, 0.3)
    g.strokeRoundedRect(x + 14, y + 6, 36, 10, 2)

    // Chair — dark with cyan highlight
    g.fillStyle(0x000000, 0.25)
    g.fillRoundedRect(x + 18, y + 33, 28, 20, 5)
    g.fillStyle(0x0f172a, 1)
    g.fillRoundedRect(x + 16, y + 31, 32, 20, 5)
    g.fillStyle(0x1e3a5f, 0.7)
    g.fillRoundedRect(x + 20, y + 34, 24, 8, 3)
    g.lineStyle(1, 0x22d3ee, 0.35)
    g.strokeRoundedRect(x + 16, y + 31, 32, 20, 5)
  }

  private drawServerRoom(g: Phaser.GameObjects.Graphics) {
    const { x, y, w, h } = AGENT_ROOMS.server_room
    g.fillStyle(0x060c1a, 1)
    g.fillRect(x, y, w, h)
    g.lineStyle(0.5, 0x22d3ee, 0.18)
    for (let gx = x + T; gx < x + w; gx += T) g.lineBetween(gx, y, gx, y + h)
    for (let gy = y + T; gy < y + h; gy += T) g.lineBetween(x, gy, x + w, gy)
    this.addRoomDepth(g, x, y, w, h)
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
    this.addRoomDepth(g, x, y, w, h)
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
    this.addRoomDepth(g, x, y, w, h)

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
    const H = 6 // half-thickness → 12px total
    if (y1 === y2) {
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2)
      // Drop shadow below (south side of horizontal wall)
      g.fillStyle(0x000000, 0.18)
      g.fillRect(minX, y1 + H + 1, maxX - minX, 5)
      // Main wall body (bright white Kumospace style)
      g.fillStyle(0xfaf7f2, 1)
      g.fillRect(minX, y1 - H, maxX - minX, H * 2)
      // North face highlight
      g.fillStyle(0xffffff, 0.8)
      g.fillRect(minX, y1 - H, maxX - minX, 3)
      // South face edge (shadowed underside)
      g.fillStyle(0xb0a898, 1)
      g.fillRect(minX, y1 + H - 4, maxX - minX, 4)
    } else {
      const minY = Math.min(y1, y2), maxY = Math.max(y1, y2)
      // Drop shadow to the right (east side of vertical wall)
      g.fillStyle(0x000000, 0.18)
      g.fillRect(x1 + H + 1, minY, 5, maxY - minY)
      // Main wall body
      g.fillStyle(0xfaf7f2, 1)
      g.fillRect(x1 - H, minY, H * 2, maxY - minY)
      // West face highlight
      g.fillStyle(0xffffff, 0.8)
      g.fillRect(x1 - H, minY, 3, maxY - minY)
      // East face edge (shadowed)
      g.fillStyle(0xb0a898, 1)
      g.fillRect(x1 + H - 4, minY, 4, maxY - minY)
    }
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
      padding: { x: 10, y: 4 },
    }).setOrigin(0.5, 0).setAlpha(0.95).setDepth(2000)
  }

  private drawDesk(g: Phaser.GameObjects.Graphics, x: number, y: number, facingSouth: boolean) {
    const dw = 76, dh = 38

    // Drop shadow
    g.fillStyle(0x000000, 0.14)
    g.fillRoundedRect(x + 4, y + 5, dw, dh, 4)

    // Desk surface — light oak
    g.fillStyle(0xe8dcc8, 1)
    g.fillRoundedRect(x, y, dw, dh, 4)
    // Surface highlight (top edge catch light)
    g.fillStyle(0xfaf4ec, 0.7)
    g.fillRoundedRect(x + 2, y + 2, dw - 4, 8, 3)
    // Desk edge (darker front lip)
    g.fillStyle(0xc4b090, 1)
    g.fillRect(x, y + dh - 4, dw, 4)
    g.lineStyle(1, 0xb09870, 0.8)
    g.strokeRoundedRect(x, y, dw, dh, 4)

    // Monitor — positioned at back of desk
    const my = facingSouth ? y + 5 : y + dh - 22
    // Monitor bezel
    g.fillStyle(0x1a1a2e, 1)
    g.fillRoundedRect(x + 15, my, 46, 18, 2)
    // Screen
    g.fillStyle(0x1e3a5f, 1)
    g.fillRoundedRect(x + 17, my + 2, 42, 13, 2)
    // Screen content glow (blue)
    g.fillStyle(0x3b82f6, 0.6)
    g.fillRoundedRect(x + 17, my + 2, 42, 6, 2)
    g.fillStyle(0x93c5fd, 0.25)
    g.fillRect(x + 19, my + 9, 30, 2)
    g.fillRect(x + 19, my + 12, 20, 1)

    // Keyboard
    g.fillStyle(0xd4cfc8, 1)
    g.fillRoundedRect(x + 18, facingSouth ? y + 24 : y + dh - 38, 40, 10, 2)
    g.fillStyle(0xbab5ae, 0.6)
    for (let k = 0; k < 4; k++) {
      g.fillRect(x + 20 + k * 9, facingSouth ? y + 26 : y + dh - 36, 7, 3)
      g.fillRect(x + 20 + k * 9, facingSouth ? y + 30 : y + dh - 32, 7, 3)
    }

    // Mouse
    g.fillStyle(0xdad5ce, 1)
    g.fillEllipse(x + dw - 12, facingSouth ? y + 26 : y + dh - 34, 8, 11)
    g.fillStyle(0xc0bbb4, 0.8)
    g.fillRect(x + dw - 13, facingSouth ? y + 26 : y + dh - 34, 1, 5)

    // Chair — below or above desk
    const chairY = facingSouth ? y + dh + 8 : y - 34
    // Chair shadow
    g.fillStyle(0x000000, 0.12)
    g.fillRoundedRect(x + 18, chairY + 3, 40, 26, 6)
    // Chair back cushion
    g.fillStyle(0x374151, 1)
    g.fillRoundedRect(x + 16, chairY, 44, 26, 6)
    // Seat highlight
    g.fillStyle(0x4b5563, 0.7)
    g.fillRoundedRect(x + 20, chairY + 3, 36, 10, 4)
    // Chair arm hints
    g.fillStyle(0x1f2937, 1)
    g.fillRoundedRect(x + 16, chairY + 4, 5, 14, 2)
    g.fillRoundedRect(x + 55, chairY + 4, 5, 14, 2)
    g.lineStyle(1, 0x4b5563, 0.5)
    g.strokeRoundedRect(x + 16, chairY, 44, 26, 6)
  }

  private drawSofa(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, facingDown: boolean) {
    const dark  = color & 0xbfbfbf   // ~25% darker
    const light = Math.min(0xffffff, ((((color >> 16) & 0xff) + 40) << 16) | ((((color >> 8) & 0xff) + 40) << 8) | (((color) & 0xff) + 40))

    // Shadow
    g.fillStyle(0x000000, 0.15)
    g.fillRoundedRect(x + 3, y + 4, w, h, 6)
    // Frame
    g.fillStyle(dark, 1)
    g.fillRoundedRect(x, y, w, h, 6)
    // Seat cushion
    g.fillStyle(color, 1)
    g.fillRoundedRect(x + 4, facingDown ? y + 4 : y, w - 8, h - 10, 5)
    // Back cushion stripe (top or bottom depending on direction)
    g.fillStyle(light, 0.35)
    if (facingDown) g.fillRoundedRect(x + 4, y + 4, w - 8, 8, 4)
    else            g.fillRoundedRect(x + 4, y + h - 12, w - 8, 8, 4)
    // Armrests
    g.fillStyle(dark, 1)
    g.fillRoundedRect(x, y + 4, 7, h - 8, 3)
    g.fillRoundedRect(x + w - 7, y + 4, 7, h - 8, 3)
    g.lineStyle(1, dark, 0.6)
    g.strokeRoundedRect(x, y, w, h, 6)
  }

  private drawWallTV(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    // Bezel
    g.fillStyle(0x0f172a, 1)
    g.fillRoundedRect(x, y, w, h, 3)
    g.lineStyle(1, 0x1e293b, 1)
    g.strokeRoundedRect(x, y, w, h, 3)
    // Screen
    g.fillStyle(0x1e3a5f, 1)
    g.fillRoundedRect(x + 2, y + 2, w - 4, h - 4, 2)
    // Screen content
    g.fillStyle(0x3b82f6, 0.55)
    g.fillRoundedRect(x + 2, y + 2, w - 4, (h - 4) * 0.45, 2)
    g.fillStyle(0x93c5fd, 0.3)
    g.fillRect(x + 6, y + (h * 0.55), w - 12, 3)
    g.fillRect(x + 6, y + (h * 0.7), (w - 12) * 0.65, 3)
    // Camera dot
    g.fillStyle(0x475569, 1)
    g.fillCircle(x + w / 2, y - 4, 2.5)
  }

  private drawNoticeboard(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    // Board backing
    g.fillStyle(0x92400e, 1)
    g.fillRoundedRect(x, y, w, h, 3)
    // Cork surface
    g.fillStyle(0xd97706, 1)
    g.fillRoundedRect(x + 3, y + 3, w - 6, h - 6, 2)
    // Pinned notes
    const noteColors = [0xfde68a, 0xfca5a5, 0xa7f3d0, 0xbfdbfe, 0xf9a8d4]
    const cols = 3, rows = 2
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const nx = x + 6 + c * ((w - 12) / cols)
        const ny = y + 6 + r * ((h - 12) / rows)
        const nw = (w - 12) / cols - 4, nh = (h - 12) / rows - 4
        g.fillStyle(noteColors[(r * cols + c) % noteColors.length], 0.9)
        g.fillRoundedRect(nx, ny, nw, nh, 1)
        // Pin
        g.fillStyle(0xef4444, 1)
        g.fillCircle(nx + nw / 2, ny + 2, 2)
      }
    }
  }

  private drawWallArt(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, style: 'abstract' | 'city' | 'lines') {
    // Shadow + frame
    g.fillStyle(0x000000, 0.14)
    g.fillRoundedRect(x + 2, y + 3, w, h, 2)
    g.fillStyle(0x7a5c3a, 1)
    g.fillRoundedRect(x, y, w, h, 2)
    // Mat
    const m = 3
    g.fillStyle(0xf8f4ee, 1)
    g.fillRect(x + m, y + m, w - m * 2, h - m * 2)
    const ix = x + m + 2, iy = y + m + 2, iw = w - m * 2 - 4, ih = h - m * 2 - 4

    if (style === 'abstract') {
      // Bold color blocks
      g.fillStyle(0x3b82f6, 0.85); g.fillRect(ix, iy, iw * 0.5, ih * 0.55)
      g.fillStyle(0xf97316, 0.85); g.fillRect(ix + iw * 0.5, iy, iw * 0.5, ih * 0.4)
      g.fillStyle(0xfbbf24, 0.85); g.fillRect(ix, iy + ih * 0.55, iw * 0.35, ih * 0.45)
      g.fillStyle(0x10b981, 0.85); g.fillRect(ix + iw * 0.35, iy + ih * 0.4, iw * 0.65, ih * 0.6)
    } else if (style === 'city') {
      // Simplified skyline
      g.fillStyle(0x1e3a5f, 1); g.fillRect(ix, iy, iw, ih)
      g.fillStyle(0xfde047, 0.5); g.fillRect(ix, iy, iw, ih * 0.35)
      const blds = [8, 16, 10, 20, 12, 18, 9, 14, 22, 11]
      blds.forEach((bh2, i) => {
        const bx2 = ix + i * (iw / blds.length)
        const bw2 = iw / blds.length - 1
        g.fillStyle(0x1e293b, 1)
        g.fillRect(bx2, iy + ih - bh2, bw2, bh2)
        g.fillStyle(0xfde047, 0.6); g.fillRect(bx2 + 1, iy + ih - bh2 + 2, 2, 2)
      })
    } else {
      // Horizontal line art
      const lineColors = [0x6366f1, 0xec4899, 0xf97316, 0x22c55e, 0x06b6d4]
      for (let l = 0; l < 5; l++) {
        const ly2 = iy + (ih / 6) * (l + 0.5)
        g.lineStyle(2, lineColors[l], 0.75)
        g.lineBetween(ix, ly2, ix + iw * (0.4 + l * 0.12), ly2)
      }
    }
  }

  private drawColumn(g: Phaser.GameObjects.Graphics, x: number, y: number, r = 9) {
    g.fillStyle(0x000000, 0.22)
    g.fillEllipse(x + 3, y + 4, r * 2.4, r * 2.4)
    g.fillStyle(0xddd8d0, 1)
    g.fillCircle(x, y, r)
    g.fillStyle(0xffffff, 0.55)
    g.fillCircle(x - r * 0.32, y - r * 0.32, r * 0.42)
    g.lineStyle(1.5, 0xb0a898, 1)
    g.strokeCircle(x, y, r)
    g.lineStyle(1, 0xd8d2c8, 0.5)
    g.strokeCircle(x, y, r * 1.4)
  }

  private showClickRipple(x: number, y: number) {
    const g = this.add.graphics()
    g.lineStyle(2, 0x22d3ee, 0.85)
    g.strokeCircle(x, y, 10)
    g.fillStyle(0x22d3ee, 0.18)
    g.fillCircle(x, y, 8)
    g.setDepth(3000)
    this.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: 2.5,
      scaleY: 2.5,
      duration: 450,
      ease: 'Cubic.easeOut',
      onComplete: () => g.destroy(),
    })
  }

  private addRoomDepth(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    // Gradient shadow cast from north wall onto floor (wall casts shadow southward)
    const nAlphas = [0.22, 0.15, 0.10, 0.06, 0.03, 0.01]
    const nStepH = 3
    nAlphas.forEach((alpha, i) => {
      g.fillStyle(0x000000, alpha)
      g.fillRect(x, y + i * nStepH, w, nStepH)
    })
    // Gradient shadow cast from west wall onto floor (wall casts shadow eastward)
    const wAlphas = [0.16, 0.10, 0.06, 0.03, 0.01]
    const wStepW = 3
    wAlphas.forEach((alpha, i) => {
      g.fillStyle(0x000000, alpha)
      g.fillRect(x + i * wStepW, y, wStepW, h)
    })
  }

  private drawPlant(g: Phaser.GameObjects.Graphics, px: number, py: number, r = 12) {
    // Ground shadow
    g.fillStyle(0x000000, 0.18)
    g.fillEllipse(px + 2, py + r + 2, r * 2.6, r * 0.7)

    // Terracotta pot
    const potW = Math.round(r * 1.4), potH = Math.round(r * 0.9)
    g.fillStyle(0xc27a50, 1)
    g.fillRoundedRect(px - potW / 2, py - potH / 2 + r, potW, potH, 3)
    g.fillStyle(0xe09060, 0.7)
    g.fillRoundedRect(px - potW / 2 + 2, py - potH / 2 + r + 2, potW - 4, 5, 2)
    g.lineStyle(1, 0x9a5a30, 0.9)
    g.strokeRoundedRect(px - potW / 2, py - potH / 2 + r, potW, potH, 3)

    // Foliage — layered circles for depth
    // Outer dark leaves
    g.fillStyle(0x166534, 1)
    g.fillCircle(px - r * 0.55, py - r * 0.5, r * 0.75)
    g.fillCircle(px + r * 0.55, py - r * 0.5, r * 0.75)
    g.fillCircle(px, py - r * 0.85, r * 0.78)
    // Main foliage body
    g.fillStyle(0x16a34a, 1)
    g.fillCircle(px, py - r * 0.3, r)
    g.fillCircle(px - r * 0.45, py - r * 0.55, r * 0.72)
    g.fillCircle(px + r * 0.45, py - r * 0.55, r * 0.72)
    // Mid highlights
    g.fillStyle(0x22c55e, 0.65)
    g.fillCircle(px - r * 0.2, py - r * 0.6, r * 0.5)
    g.fillCircle(px + r * 0.3, py - r * 0.2, r * 0.4)
    // Bright center highlight
    g.fillStyle(0x4ade80, 0.5)
    g.fillCircle(px - r * 0.1, py - r * 0.45, r * 0.3)
    // Tiny specular
    g.fillStyle(0x86efac, 0.4)
    g.fillCircle(px - r * 0.2, py - r * 0.7, r * 0.15)
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
    const viewW = this.cameras.main.width
    const viewH = this.cameras.main.height
    const zoom = Math.max(Math.max(viewW / W, viewH / H), 0.5)
    this.cameras.main.setZoom(zoom)
    this.cameras.main.centerOn(this.localPlayer.x, this.localPlayer.y)
  }

  private setupInput() {
    const roomBounds = getRoomPixelBounds(this.sceneData.floor)
    this.roomBounds = roomBounds
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
      if (pointer.button !== 0) return
      // Suppress player move while decorating, or when clicking on any interactive object (door, decoration)
      if (this.decorateMode) return
      if (currentlyOver && currentlyOver.length > 0) return
      if (this.doorSystem.isPointBlocked(pointer.worldX, pointer.worldY, roomBounds)) return
      this.localPlayer.moveToPoint(pointer.worldX, pointer.worldY)
      this.showClickRipple(pointer.worldX, pointer.worldY)
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
    this.emitter.on('focusUpdate', ({ focusMode, focusTask, focusEndsAt }) => {
      this.presenceSystem?.updateFocus(focusMode, focusTask, focusEndsAt)
      this.localPlayer?.setFocusMode(focusMode, focusTask)
    })
  }

  // ──────────────────────────────────────────────────────────────
  // GAME LOOP
  // ──────────────────────────────────────────────────────────────
  update(_time: number, delta: number) {
    const prevX = this.localPlayer.x
    const prevY = this.localPlayer.y

    this.localPlayer.update(delta)
    for (const uid of Object.keys(this.remotePlayers)) this.remotePlayers[uid].update(delta)

    // Y-depth sort: avatars lower on screen render above those higher up (3D feel)
    this.localPlayer.setDepth(this.localPlayer.y)
    for (const uid of Object.keys(this.remotePlayers)) {
      const r = this.remotePlayers[uid]
      r.setDepth(r.y)
    }

    // Block entry into locked rooms — revert position and cancel target
    if (this.roomBounds && this.doorSystem?.isPointBlocked(this.localPlayer.x, this.localPlayer.y, this.roomBounds)) {
      this.localPlayer.setPosition(prevX, prevY)
    }

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
        if (!this.doorSystem.isPointBlocked(nx, ny, this.roomBounds)) {
          this.localPlayer.moveDirectly(nx - this.localPlayer.x, ny - this.localPlayer.y)
        }
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
      this.remotePlayers[p.userId].setFocusMode(!!p.focus_mode, p.focus_task ?? '')
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
