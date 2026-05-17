import Phaser from 'phaser'

// Must match AvatarCustomizer + Avatar component colors
export const AVATAR_COLORS = [
  '#F97316', '#14B8A6', '#6366F1', '#EC4899',
  '#8B5CF6', '#EAB308', '#22C55E', '#06B6D4',
]

function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

function lighten(color: number, amount = 60): number {
  const r = Math.min(255, ((color >> 16) & 0xff) + amount)
  const g = Math.min(255, ((color >> 8) & 0xff) + amount)
  const b = Math.min(255, (color & 0xff) + amount)
  return (r << 16) | (g << 8) | b
}

function drawCreature(g: Phaser.GameObjects.Graphics, colorHex: string, isLocal: boolean) {
  const color = hexToInt(colorHex)
  const light = lighten(color, 50)
  const r = 13

  g.fillStyle(0x000000, 0.2)
  g.fillEllipse(1, r + 7, 28, 9)

  g.fillStyle(color, 1)
  g.fillCircle(0, 0, r)

  g.fillStyle(0xffffff, 0.25)
  g.fillCircle(-4, -5, 5)

  g.lineStyle(1.5, light, 0.9)
  g.strokeCircle(0, 0, r)

  g.fillStyle(color, 1)
  g.fillCircle(-7, -11, 4)
  g.fillCircle(7, -11, 4)
  g.lineStyle(1, light, 0.7)
  g.strokeCircle(-7, -11, 4)
  g.strokeCircle(7, -11, 4)

  g.fillStyle(0xffffff, 1)
  g.fillCircle(-4, -2, 4)
  g.fillCircle(4, -2, 4)

  g.fillStyle(0x1a1a2e, 1)
  g.fillCircle(-3, -1, 2.5)
  g.fillCircle(5, -1, 2.5)

  g.fillStyle(0xffffff, 1)
  g.fillCircle(-2, -2, 1)
  g.fillCircle(6, -2, 1)

  g.lineStyle(1.5, 0x1a1a2e, 1)
  g.beginPath()
  g.arc(0, 4, 5, 0.2, Math.PI - 0.2, false)
  g.strokePath()

  if (isLocal) {
    const bx = -7
    const by = -r - 14
    g.fillStyle(0xffd700, 1)
    g.fillRect(bx, by + 6, 14, 4)
    g.fillTriangle(bx, by + 6, bx + 2, by, bx + 4, by + 6)
    g.fillTriangle(bx + 4, by + 6, bx + 7, by - 3, bx + 10, by + 6)
    g.fillTriangle(bx + 10, by + 6, bx + 12, by, bx + 14, by + 6)
  }
}

function drawPhotoRing(g: Phaser.GameObjects.Graphics, colorHex: string, isLocal: boolean) {
  const color = hexToInt(colorHex)
  const r = 16

  // Shadow under
  g.fillStyle(0x000000, 0.25)
  g.fillEllipse(2, r + 6, 30, 9)
  // Colored ring (drawn behind photo)
  g.fillStyle(color, 1)
  g.fillCircle(0, 0, r + 2)
  g.fillStyle(0xffffff, 0.9)
  g.fillCircle(0, 0, r)

  if (isLocal) {
    const bx = -8
    const by = -r - 14
    g.fillStyle(0xffd700, 1)
    g.fillRect(bx, by + 6, 16, 4)
    g.fillTriangle(bx, by + 6, bx + 2, by, bx + 4, by + 6)
    g.fillTriangle(bx + 4, by + 6, bx + 8, by - 3, bx + 12, by + 6)
    g.fillTriangle(bx + 12, by + 6, bx + 14, by, bx + 16, by + 6)
  }
}

export class PlayerAvatar {
  private scene: Phaser.Scene
  private container: Phaser.GameObjects.Container
  private gfx: Phaser.GameObjects.Graphics
  private photoImage?: Phaser.GameObjects.Image
  private nameTag: Phaser.GameObjects.Text
  public userId: string
  public displayName: string
  public avatarIndex: number
  public avatarUrl: string | null
  public isMoving = false
  public x: number
  public y: number
  private targetX: number
  private targetY: number
  private speed = 200
  private floatTime: number
  private isLocal: boolean

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    userId: string,
    displayName: string,
    avatarIndex: number,
    isLocal = false,
    avatarUrl: string | null = null,
  ) {
    this.scene = scene
    this.x = x
    this.y = y
    this.userId = userId
    this.displayName = displayName
    this.avatarIndex = avatarIndex
    this.avatarUrl = avatarUrl
    this.isLocal = isLocal
    void this.isLocal
    this.targetX = x
    this.targetY = y
    this.floatTime = Math.random() * Math.PI * 2

    const colorHex = AVATAR_COLORS[avatarIndex % AVATAR_COLORS.length]

    this.container = scene.add.container(x, y)

    this.gfx = scene.add.graphics()
    if (avatarUrl) {
      drawPhotoRing(this.gfx, colorHex, isLocal)
    } else {
      drawCreature(this.gfx, colorHex, isLocal)
    }
    this.container.add(this.gfx)

    this.nameTag = scene.add.text(0, 22, displayName, {
      fontSize: '10px',
      color: '#ffffff',
      backgroundColor: '#000000bb',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 0)
    this.container.add(this.nameTag)

    this.container.setSize(36, 36)

    if (avatarUrl) {
      this.loadPhoto(avatarUrl)
    }
  }

  private loadPhoto(url: string) {
    const key = `photo_${this.userId}`
    const apply = () => {
      if (this.photoImage) { this.photoImage.destroy(); this.photoImage = undefined }
      const r = 14
      const img = this.scene.add.image(0, 0, key)
      const tex = this.scene.textures.get(key)
      const src = tex.source[0]
      if (!src || !src.width || !src.height) return
      const scale = (r * 2) / Math.min(src.width, src.height)
      img.setScale(scale)
      // Geometry mask for circle clipping (mask is in world coords)
      const mask = this.scene.make.graphics({ x: 0, y: 0 })
      mask.fillStyle(0xffffff)
      mask.fillCircle(this.x, this.y, r)
      const geomMask = mask.createGeometryMask()
      img.setMask(geomMask)
      this.container.add(img)
      this.photoImage = img
      // Update mask position on every move (handled in update())
      ;(this as unknown as { _photoMask: Phaser.Display.Masks.GeometryMask; _photoMaskGfx: Phaser.GameObjects.Graphics })._photoMask = geomMask
      ;(this as unknown as { _photoMaskGfx: Phaser.GameObjects.Graphics })._photoMaskGfx = mask
    }
    if (this.scene.textures.exists(key)) {
      apply()
      return
    }
    this.scene.load.image(key, url)
    this.scene.load.once(`filecomplete-image-${key}`, apply)
    this.scene.load.once('loaderror', () => {
      console.warn('[PlayerAvatar] photo load failed:', url)
    })
    if (!this.scene.load.isLoading()) this.scene.load.start()
  }

  private updatePhotoMask() {
    const m = (this as unknown as { _photoMaskGfx?: Phaser.GameObjects.Graphics })._photoMaskGfx
    if (m) {
      m.clear()
      m.fillStyle(0xffffff)
      m.fillCircle(this.container.x, this.container.y, 14)
    }
  }

  private applyFlip(dx: number) {
    if (dx === 0) return
    const s = dx < 0 ? -1 : 1
    this.container.setScale(s, 1)
    this.nameTag.setScale(s, 1)
  }

  moveToPoint(x: number, y: number) {
    this.targetX = x
    this.targetY = y
    this.isMoving = true
  }

  moveDirectly(dx: number, dy: number) {
    this.x += dx
    this.y += dy
    this.targetX = this.x
    this.targetY = this.y
    this.isMoving = true
    this.applyFlip(dx)
    this.container.setPosition(this.x, this.y)
    this.updatePhotoMask()
  }

  stopWalking() {
    this.isMoving = false
  }

  setPosition(x: number, y: number) {
    this.x = x
    this.y = y
    this.targetX = x
    this.targetY = y
    this.container.setPosition(x, y)
    this.updatePhotoMask()
  }

  update(delta: number) {
    const dx = this.targetX - this.x
    const dy = this.targetY - this.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < 3) {
      this.x = this.targetX
      this.y = this.targetY
      this.isMoving = false
    } else {
      const speed = this.speed * (delta / 1000)
      this.x += (dx / dist) * speed
      this.y += (dy / dist) * speed
      this.isMoving = true
      this.applyFlip(dx)
    }

    if (!this.isMoving) {
      this.floatTime += delta / 1200
      const floatY = Math.sin(this.floatTime) * 4
      this.container.setPosition(this.x, this.y + floatY)
    } else {
      this.container.setPosition(this.x, this.y)
    }
    this.updatePhotoMask()
  }

  private destroyed = false
  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    const ref = this as unknown as { _photoMaskGfx?: Phaser.GameObjects.Graphics }
    if (ref._photoMaskGfx) {
      ref._photoMaskGfx.destroy()
      ref._photoMaskGfx = undefined
    }
    if (this.container && this.container.scene) this.container.destroy()
  }
}
