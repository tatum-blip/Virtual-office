import Phaser from 'phaser'

export type DoorState = 'open' | 'closed' | 'locked'
export type DoorOrientation = 'h' | 'v' // horizontal gap in h-wall, vertical gap in v-wall

export interface DoorDef {
  id: string
  roomId: string          // which room this door belongs to
  wx: number              // world x of door centre
  wy: number              // world y of door centre
  orientation: DoorOrientation
  state: DoorState
}

interface LiveDoor extends DoorDef {
  container: Phaser.GameObjects.Container
}

const DOOR_LEN = 52   // gap length (parallel to wall)
const DOOR_THICK = 10 // door panel thickness

export class DoorSystem {
  private scene: Phaser.Scene
  private doors = new Map<string, LiveDoor>()
  private onToggle?: (roomId: string, locked: boolean) => void
  private toastText: Phaser.GameObjects.Text | null = null

  constructor(scene: Phaser.Scene, onToggle?: (roomId: string, locked: boolean) => void) {
    this.scene = scene
    this.onToggle = onToggle
  }

  add(def: DoorDef) {
    const container = this.scene.add.container(def.wx, def.wy)
    const door: LiveDoor = { ...def, container }
    this.doors.set(def.id, door)
    this.render(door)
  }

  private render(door: LiveDoor) {
    door.container.removeAll(true)

    const g = this.scene.add.graphics()
    const isH = door.orientation === 'h'
    const pw = isH ? DOOR_LEN : DOOR_THICK   // panel width
    const ph = isH ? DOOR_THICK : DOOR_LEN   // panel height
    const hw = pw / 2, hh = ph / 2

    // Door frame posts
    g.fillStyle(0x4b5563, 1)
    if (isH) {
      g.fillRect(-hw - 7, -hh - 2, 7, ph + 4)
      g.fillRect(hw, -hh - 2, 7, ph + 4)
    } else {
      g.fillRect(-hw - 2, -hh - 7, pw + 4, 7)
      g.fillRect(-hw - 2, hh, pw + 4, 7)
    }

    if (door.state !== 'open') {
      const col = door.state === 'locked' ? 0xdc2626 : 0x6b7280
      const colLight = door.state === 'locked' ? 0xef4444 : 0x9ca3af

      // Shadow
      g.fillStyle(0x000000, 0.2)
      g.fillRoundedRect(-hw + 3, -hh + 3, pw, ph, 3)

      // Panel
      g.fillStyle(col, 0.92)
      g.fillRoundedRect(-hw, -hh, pw, ph, 3)
      g.lineStyle(1.5, colLight, 0.8)
      g.strokeRoundedRect(-hw, -hh, pw, ph, 3)

      // Highlight stripe
      g.fillStyle(0xffffff, 0.1)
      if (isH) g.fillRoundedRect(-hw + 2, -hh + 2, pw - 4, 4, 2)
      else g.fillRoundedRect(-hw + 2, -hh + 2, 4, ph - 4, 2)

      // Handle
      g.fillStyle(0xfcd34d, 1)
      g.fillCircle(isH ? pw * 0.28 : 0, isH ? 0 : ph * 0.28, 3.5)
      g.fillStyle(0xf59e0b, 1)
      g.fillCircle(isH ? pw * 0.28 : 0, isH ? 0 : ph * 0.28, 2)
    }

    door.container.add(g)

    // Lock icon
    if (door.state === 'locked') {
      const lock = this.scene.add.text(0, isH ? -18 : -22, '🔒', {
        fontSize: '14px',
      }).setOrigin(0.5)
      door.container.add(lock)
    }

    // Hit area — make it generous for clicking
    const hitW = isH ? DOOR_LEN + 20 : DOOR_THICK + 24
    const hitH = isH ? DOOR_THICK + 24 : DOOR_LEN + 20
    door.container.setSize(hitW, hitH)
    door.container.setInteractive({ useHandCursor: true })

    door.container.off('pointerdown')
    door.container.off('pointerover')
    door.container.off('pointerout')

    door.container.on('pointerdown', () => this.handleClick(door.id))
    door.container.on('pointerover', () => {
      if (door.state !== 'locked') door.container.setAlpha(0.8)
    })
    door.container.on('pointerout', () => door.container.setAlpha(1))
  }

  private handleClick(id: string) {
    const door = this.doors.get(id)
    if (!door) return
    if (door.state === 'locked') {
      this.showToast('Room is locked 🔒', door.wx, door.wy)
      return
    }
    const next: DoorState = door.state === 'open' ? 'closed' : 'open'
    this.setState(id, next)
  }

  setState(id: string, state: DoorState) {
    const door = this.doors.get(id)
    if (!door) return
    door.state = state
    this.render(door)
  }

  setRoomLocked(roomId: string, locked: boolean) {
    this.doors.forEach((d) => {
      if (d.roomId === roomId) {
        this.setState(d.id, locked ? 'locked' : 'open')
      }
    })
    this.onToggle?.(roomId, locked)
  }

  isRoomLocked(roomId: string): boolean {
    for (const d of this.doors.values()) {
      if (d.roomId === roomId && d.state === 'locked') return true
    }
    return false
  }

  isPointBlocked(worldX: number, worldY: number, rooms: Array<{ name: string; px1: number; py1: number; px2: number; py2: number }>): boolean {
    for (const room of rooms) {
      if (
        worldX >= room.px1 && worldX <= room.px2 &&
        worldY >= room.py1 && worldY <= room.py2
      ) {
        return this.isRoomLocked(room.name)
      }
    }
    return false
  }

  private showToast(msg: string, wx: number, wy: number) {
    this.toastText?.destroy()
    this.toastText = this.scene.add.text(wx, wy - 40, msg, {
      fontSize: '11px',
      color: '#ffffff',
      backgroundColor: '#dc2626cc',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setDepth(100)

    this.scene.time.delayedCall(1800, () => {
      this.toastText?.destroy()
      this.toastText = null
    })
  }

  getAllDoors(): LiveDoor[] {
    return Array.from(this.doors.values())
  }

  destroy() {
    this.doors.forEach((d) => d.container.destroy())
    this.toastText?.destroy()
  }
}
