import Phaser from 'phaser'
import type { Emitter } from 'mitt'
import type { OfficeEvents, DecorationItem } from '@/game/scenes/OfficeScene'

interface DecorationLiveObject extends DecorationItem {
  container: Phaser.GameObjects.Container
}

export class DecorationSystem {
  private scene: Phaser.Scene
  private emitter: Emitter<OfficeEvents>
  private objects = new Map<string, DecorationLiveObject>()
  private decorateMode = false
  private placementType: string | null = null
  private placementPreview?: Phaser.GameObjects.Container
  private onMove: (id: string, x: number, y: number) => void
  private onPlace: (type: string, x: number, y: number) => void
  private onRemove: (id: string) => void

  constructor(
    scene: Phaser.Scene,
    emitter: Emitter<OfficeEvents>,
    handlers: {
      onMove: (id: string, x: number, y: number) => void
      onPlace: (type: string, x: number, y: number) => void
      onRemove: (id: string) => void
    },
  ) {
    this.scene = scene
    this.emitter = emitter
    this.onMove = handlers.onMove
    this.onPlace = handlers.onPlace
    this.onRemove = handlers.onRemove

    this.emitter.on('setDecorateMode', this.handleSetDecorateMode)
    this.emitter.on('selectDecorationType', this.handleSelectType)
    this.emitter.on('applyDecorations', this.handleApplyDecorations)

    // Listen for placement clicks (right-click cancels)
    this.scene.input.on('pointerdown', this.handlePointerDown, this)
    this.scene.input.on('pointermove', this.handlePointerMove, this)
  }

  /** Replace the current decoration set with the given list (e.g. from Supabase). */
  syncList(items: DecorationItem[]) {
    const incoming = new Set(items.map((i) => i.id))
    // Remove objects no longer present
    for (const id of Array.from(this.objects.keys())) {
      if (!incoming.has(id)) {
        this.objects.get(id)?.container.destroy()
        this.objects.delete(id)
      }
    }
    // Add or update
    for (const item of items) {
      const existing = this.objects.get(item.id)
      if (existing) {
        if (Math.abs(existing.x - item.x) > 0.5 || Math.abs(existing.y - item.y) > 0.5) {
          existing.x = item.x
          existing.y = item.y
          existing.container.setPosition(item.x, item.y)
        }
      } else {
        this.spawnObject(item)
      }
    }
  }

  private spawnObject(item: DecorationItem) {
    const container = this.scene.add.container(item.x, item.y)
    const g = this.scene.add.graphics()
    drawDecoration(g, item.type)
    container.add(g)
    const bounds = decorationBounds(item.type)
    container.setSize(bounds.w, bounds.h)
    const live: DecorationLiveObject = { ...item, container }
    this.objects.set(item.id, live)
    this.applyInteractive(live)
  }

  private applyInteractive(live: DecorationLiveObject) {
    const c = live.container
    c.removeAllListeners()
    if (!this.decorateMode) {
      c.disableInteractive()
      c.setAlpha(1)
      return
    }
    // Containers need an explicit hit area
    const bounds = decorationBounds(live.type)
    const hit = new Phaser.Geom.Rectangle(-bounds.w / 2, -bounds.h / 2, bounds.w, bounds.h)
    c.setInteractive(hit, Phaser.Geom.Rectangle.Contains)
    this.scene.input.setDraggable(c, true)
    c.on('pointerover', () => c.setAlpha(0.85))
    c.on('pointerout', () => c.setAlpha(1))
    c.on('drag', (_p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      c.setPosition(dragX, dragY)
      live.x = dragX
      live.y = dragY
    })
    c.on('dragend', () => {
      this.onMove(live.id, live.x, live.y)
    })
    c.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Right-click to remove a decoration
      if (pointer.button === 2) {
        this.onRemove(live.id)
      }
    })
  }

  private handleSetDecorateMode = (enabled: boolean) => {
    this.decorateMode = enabled
    if (!enabled) {
      this.cancelPlacement()
    }
    for (const live of Array.from(this.objects.values())) {
      this.applyInteractive(live)
    }
  }

  private handleSelectType = (type: string | null) => {
    if (!this.decorateMode || !type) {
      this.cancelPlacement()
      return
    }
    this.placementType = type
    if (this.placementPreview) { this.placementPreview.destroy(); this.placementPreview = undefined }
    const preview = this.scene.add.container(-9999, -9999)
    const g = this.scene.add.graphics()
    drawDecoration(g, type)
    preview.add(g)
    preview.setAlpha(0.55)
    this.placementPreview = preview
  }

  private handleApplyDecorations = (items: DecorationItem[]) => {
    this.syncList(items)
  }

  private cancelPlacement() {
    this.placementType = null
    if (this.placementPreview) {
      this.placementPreview.destroy()
      this.placementPreview = undefined
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (this.placementPreview && this.placementType) {
      this.placementPreview.setPosition(pointer.worldX, pointer.worldY)
    }
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    if (!this.decorateMode || !this.placementType) return
    // Left click places, right click cancels placement
    if (pointer.button === 2) {
      this.cancelPlacement()
      return
    }
    if (pointer.button !== 0) return
    const type = this.placementType
    this.onPlace(type, pointer.worldX, pointer.worldY)
    this.cancelPlacement()
  }

  destroy() {
    this.emitter.off('setDecorateMode', this.handleSetDecorateMode)
    this.emitter.off('selectDecorationType', this.handleSelectType)
    this.emitter.off('applyDecorations', this.handleApplyDecorations)
    this.scene.input.off('pointerdown', this.handlePointerDown, this)
    this.scene.input.off('pointermove', this.handlePointerMove, this)
    for (const live of Array.from(this.objects.values())) live.container.destroy()
    this.objects.clear()
    this.placementPreview?.destroy()
  }
}

// ──────────────────────────────────────────────────────────────
// Decoration drawing (procedural — no asset deps)
// ──────────────────────────────────────────────────────────────
function decorationBounds(type: string): { w: number; h: number } {
  switch (type) {
    case 'plant_sm':     return { w: 24, h: 32 }
    case 'plant_lg':     return { w: 36, h: 50 }
    case 'plant_cactus': return { w: 22, h: 32 }
    case 'sofa':         return { w: 90, h: 42 }
    case 'chair_lounge': return { w: 40, h: 40 }
    case 'bean_bag':     return { w: 36, h: 36 }
    case 'rug_blue':
    case 'rug_red':      return { w: 120, h: 70 }
    case 'poster':       return { w: 40, h: 50 }
    case 'lamp':         return { w: 18, h: 48 }
    case 'arcade':       return { w: 40, h: 60 }
    case 'whiteboard':   return { w: 70, h: 44 }
    case 'monitor':      return { w: 36, h: 32 }
    default:             return { w: 32, h: 32 }
  }
}

function drawDecoration(g: Phaser.GameObjects.Graphics, type: string) {
  switch (type) {
    case 'plant_sm':     return drawPlant(g, 0, 0, 10)
    case 'plant_lg':     return drawPlant(g, 0, 4, 16)
    case 'plant_cactus': return drawCactus(g)
    case 'sofa':         return drawSofa(g)
    case 'chair_lounge': return drawLoungeChair(g)
    case 'bean_bag':     return drawBeanBag(g)
    case 'rug_blue':     return drawRug(g, 0x3b82f6)
    case 'rug_red':      return drawRug(g, 0xb91c1c)
    case 'poster':       return drawPoster(g)
    case 'lamp':         return drawLamp(g)
    case 'arcade':       return drawArcade(g)
    case 'whiteboard':   return drawWhiteboard(g)
    case 'monitor':      return drawMonitor(g)
  }
}

function drawPlant(g: Phaser.GameObjects.Graphics, px: number, py: number, r: number) {
  g.fillStyle(0x000000, 0.18)
  g.fillEllipse(px + 2, py + 13, 22, 7)
  g.fillStyle(0x8b5a2b, 1)
  g.fillRoundedRect(px - 9, py, 18, 12, 2)
  g.fillStyle(0x6b4020, 0.5)
  g.fillRoundedRect(px - 7, py + 2, 14, 5, 2)
  g.lineStyle(1, 0x4a2810, 1)
  g.strokeRoundedRect(px - 9, py, 18, 12, 2)
  g.fillStyle(0x15803d, 1)
  g.fillCircle(px, py - r, r)
  g.fillCircle(px - r * 0.6, py - r * 0.6, r * 0.7)
  g.fillCircle(px + r * 0.6, py - r * 0.6, r * 0.7)
  g.fillStyle(0x22c55e, 0.55)
  g.fillCircle(px - r * 0.2, py - r * 1.1, r * 0.4)
  g.fillStyle(0x4ade80, 0.4)
  g.fillCircle(px - r * 0.35, py - r * 1.3, r * 0.22)
}

function drawCactus(g: Phaser.GameObjects.Graphics) {
  g.fillStyle(0x000000, 0.18)
  g.fillEllipse(0, 14, 18, 6)
  g.fillStyle(0xa16207, 1)
  g.fillRoundedRect(-8, 6, 16, 10, 2)
  g.fillStyle(0x16a34a, 1)
  g.fillRoundedRect(-6, -14, 12, 22, 5)
  g.fillRoundedRect(-12, -6, 6, 12, 3)
  g.fillRoundedRect(6, -10, 6, 14, 3)
  g.fillStyle(0xffffff, 0.4)
  g.fillCircle(-1, -8, 1)
  g.fillCircle(2, -2, 1)
}

function drawSofa(g: Phaser.GameObjects.Graphics) {
  g.fillStyle(0x000000, 0.18)
  g.fillRoundedRect(-43, -18, 90, 42, 7)
  g.fillStyle(0x991b1b, 1)
  g.fillRoundedRect(-45, -20, 90, 42, 7)
  g.fillStyle(0xb91c1c, 1)
  g.fillRoundedRect(-43, -18, 86, 18, 5)
  g.lineStyle(1, 0x7f1d1d, 1)
  g.strokeRoundedRect(-45, -20, 90, 42, 7)
  g.fillStyle(0x7f1d1d, 0.6)
  g.fillRoundedRect(-44, 0, 88, 18, 5)
}

function drawLoungeChair(g: Phaser.GameObjects.Graphics) {
  g.fillStyle(0x000000, 0.18)
  g.fillRoundedRect(-18, -16, 40, 40, 8)
  g.fillStyle(0x1e3a5f, 1)
  g.fillRoundedRect(-20, -18, 40, 40, 8)
  g.fillStyle(0x2a4f7c, 0.6)
  g.fillRoundedRect(-18, -16, 36, 16, 6)
  g.lineStyle(1, 0x111827, 1)
  g.strokeRoundedRect(-20, -18, 40, 40, 8)
}

function drawBeanBag(g: Phaser.GameObjects.Graphics) {
  g.fillStyle(0x000000, 0.18)
  g.fillCircle(2, 4, 18)
  g.fillStyle(0x7c3aed, 1)
  g.fillCircle(0, 0, 18)
  g.fillStyle(0xa78bfa, 0.6)
  g.fillEllipse(-4, -6, 18, 10)
  g.lineStyle(1, 0x4c1d95, 1)
  g.strokeCircle(0, 0, 18)
}

function drawRug(g: Phaser.GameObjects.Graphics, color: number) {
  g.fillStyle(0x000000, 0.18)
  g.fillRoundedRect(-58, -33, 120, 70, 6)
  g.fillStyle(color, 0.95)
  g.fillRoundedRect(-60, -35, 120, 70, 6)
  g.fillStyle(0xffffff, 0.15)
  g.fillRoundedRect(-56, -31, 112, 62, 5)
  g.lineStyle(1, color, 0.4)
  g.strokeRoundedRect(-60, -35, 120, 70, 6)
}

function drawPoster(g: Phaser.GameObjects.Graphics) {
  g.fillStyle(0x000000, 0.18)
  g.fillRoundedRect(-19, -23, 40, 50, 3)
  g.fillStyle(0xfafafa, 1)
  g.fillRoundedRect(-20, -25, 40, 50, 3)
  g.fillStyle(0x6366f1, 0.7)
  g.fillRect(-16, -20, 32, 20)
  g.fillStyle(0xec4899, 0.7)
  g.fillCircle(0, -10, 10)
  g.fillStyle(0x1f2937, 1)
  g.fillRect(-16, 0, 32, 2)
  g.fillRect(-16, 6, 24, 2)
}

function drawLamp(g: Phaser.GameObjects.Graphics) {
  g.fillStyle(0x000000, 0.18)
  g.fillEllipse(1, 22, 18, 5)
  g.fillStyle(0x4b5563, 1)
  g.fillEllipse(0, 22, 16, 4)
  g.lineStyle(2, 0x6b7280, 1)
  g.lineBetween(0, 22, 0, -16)
  g.fillStyle(0xfde047, 1)
  g.fillTriangle(-10, -16, 10, -16, 0, -26)
  g.fillStyle(0xfef9c3, 0.6)
  g.fillCircle(0, -18, 7)
}

function drawArcade(g: Phaser.GameObjects.Graphics) {
  g.fillStyle(0x000000, 0.2)
  g.fillRoundedRect(-18, -28, 40, 60, 4)
  g.fillStyle(0x1e1b4b, 1)
  g.fillRoundedRect(-20, -30, 40, 60, 4)
  g.fillStyle(0x06b6d4, 0.95)
  g.fillRoundedRect(-16, -26, 32, 26, 3)
  g.fillStyle(0xa855f7, 0.4)
  g.fillRect(-14, -24, 28, 8)
  g.fillStyle(0xfbbf24, 1)
  g.fillCircle(-8, 6, 3)
  g.fillCircle(8, 6, 3)
  g.fillStyle(0xef4444, 1)
  g.fillCircle(0, 14, 3)
}

function drawWhiteboard(g: Phaser.GameObjects.Graphics) {
  g.fillStyle(0x000000, 0.18)
  g.fillRoundedRect(-33, -21, 70, 44, 3)
  g.fillStyle(0xfafafa, 1)
  g.fillRoundedRect(-35, -23, 70, 44, 3)
  g.lineStyle(2, 0xcbd5e1, 1)
  g.strokeRoundedRect(-35, -23, 70, 44, 3)
  g.lineStyle(2, 0x3b82f6, 0.7)
  g.lineBetween(-28, -10, -4, -8)
  g.lineStyle(1.5, 0xef4444, 0.7)
  g.lineBetween(-28, 0, 12, 2)
  g.lineStyle(1.5, 0x22c55e, 0.7)
  g.lineBetween(-28, 10, -8, 12)
}

function drawMonitor(g: Phaser.GameObjects.Graphics) {
  g.fillStyle(0x000000, 0.2)
  g.fillRoundedRect(-17, -15, 36, 28, 3)
  g.fillStyle(0x0c0c14, 1)
  g.fillRoundedRect(-18, -16, 36, 28, 3)
  g.fillStyle(0x2563eb, 1)
  g.fillRoundedRect(-16, -14, 32, 22, 2)
  g.fillStyle(0x60a5fa, 0.3)
  g.fillRect(-16, -14, 32, 9)
  g.fillStyle(0x111827, 1)
  g.fillRect(-6, 9, 12, 4)
}
