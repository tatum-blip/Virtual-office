import Phaser from 'phaser'
import type { AgentDefinition } from '@/types/agent'

type AgentState = 'idle' | 'walk'

function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

function lighten(color: number, amount = 60): number {
  const r = Math.min(255, ((color >> 16) & 0xff) + amount)
  const g = Math.min(255, ((color >> 8) & 0xff) + amount)
  const b = Math.min(255, (color & 0xff) + amount)
  return (r << 16) | (g << 8) | b
}

function drawCreature(g: Phaser.GameObjects.Graphics, colorHex: string) {
  const color = hexToInt(colorHex)
  const light = lighten(color, 50)

  // Drop shadow
  g.fillStyle(0x000000, 0.18)
  g.fillEllipse(1, 20, 26, 9)

  // Body
  g.fillStyle(color, 1)
  g.fillCircle(0, 0, 13)

  // Shine
  g.fillStyle(0xffffff, 0.22)
  g.fillCircle(-4, -5, 6)

  // Outline
  g.lineStyle(1.5, light, 0.9)
  g.strokeCircle(0, 0, 13)

  // Ears (tiny bumps on top)
  g.fillStyle(color, 1)
  g.fillCircle(-7, -11, 4)
  g.fillCircle(7, -11, 4)
  g.lineStyle(1, light, 0.7)
  g.strokeCircle(-7, -11, 4)
  g.strokeCircle(7, -11, 4)

  // Eyes
  g.fillStyle(0xffffff, 1)
  g.fillCircle(-4, -2, 4)
  g.fillCircle(4, -2, 4)

  // Pupils
  g.fillStyle(0x1a1a2e, 1)
  g.fillCircle(-3, -1, 2.5)
  g.fillCircle(5, -1, 2.5)

  // Eye shine
  g.fillStyle(0xffffff, 1)
  g.fillCircle(-2, -2, 1)
  g.fillCircle(6, -2, 1)

  // Smile
  g.lineStyle(1.5, 0x1a1a2e, 1)
  g.beginPath()
  g.arc(0, 4, 5, 0.2, Math.PI - 0.2, false)
  g.strokePath()
}

export class AgentSprite {
  private container: Phaser.GameObjects.Container
  private gfx: Phaser.GameObjects.Graphics
  private nameTag: Phaser.GameObjects.Text
  private floatTween: Phaser.Tweens.Tween | null = null
  private agentState: AgentState = 'idle'
  private stateTimer = 0
  private targetX: number
  private targetY: number
  private moveSpeed = 55
  public agentData: AgentDefinition
  private walkBounds: { x1: number; y1: number; x2: number; y2: number }
  public x: number
  public y: number

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    agent: AgentDefinition,
    _frameIndex: number,
    bounds: { x1: number; y1: number; x2: number; y2: number }
  ) {
    this.x = x
    this.y = y
    this.agentData = agent
    this.walkBounds = bounds
    this.targetX = x
    this.targetY = y

    this.container = scene.add.container(x, y)

    this.gfx = scene.add.graphics()
    drawCreature(this.gfx, agent.color_hex)
    this.container.add(this.gfx)

    this.nameTag = scene.add.text(0, 18, agent.name, {
      fontSize: '10px',
      color: '#ffffff',
      backgroundColor: '#000000bb',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 0)
    this.container.add(this.nameTag)

    this.container.setSize(30, 30)
    this.container.setInteractive({ useHandCursor: true })

    // Gentle idle float — each agent offset so they don't all sync
    this.floatTween = scene.tweens.add({
      targets: this.container,
      y: y - 5,
      duration: Phaser.Math.Between(1000, 1600),
      ease: 'Sine.inOut',
      yoyo: true,
      repeat: -1,
      delay: Phaser.Math.Between(0, 800),
    })

    this.stateTimer = Phaser.Math.Between(1000, 4000)
  }

  setOnClick(callback: (agent: AgentDefinition) => void) {
    this.container.on('pointerdown', () => callback(this.agentData))
    this.container.on('pointerover', () => {
      this.container.setScale(1.25)
      this.nameTag.setAlpha(1)
    })
    this.container.on('pointerout', () => {
      this.container.setScale(1)
    })
  }

  update(delta: number) {
    this.stateTimer -= delta

    if (this.agentState === 'idle') {
      if (this.stateTimer <= 0) {
        this.pickNewTarget()
        this.agentState = 'walk'
        this.stateTimer = Phaser.Math.Between(3000, 7000)
        // Pause float tween while walking
        this.floatTween?.pause()
      }
    } else {
      const dx = this.targetX - this.x
      const dy = this.targetY - this.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < 4) {
        this.x = this.targetX
        this.y = this.targetY
        this.agentState = 'idle'
        this.stateTimer = Phaser.Math.Between(2000, 6000)
        this.floatTween?.resume()
      } else {
        const speed = this.moveSpeed * (delta / 1000)
        this.x += (dx / dist) * speed
        this.y += (dy / dist) * speed
        this.container.setPosition(this.x, this.y)
        const s = dx < 0 ? -1 : 1
        this.container.setScale(s, 1)
        this.nameTag.setScale(s, 1)
      }
    }
  }

  destroy() {
    this.floatTween?.stop()
    this.container.destroy()
    this.nameTag.destroy()
  }

  private pickNewTarget() {
    const { x1, y1, x2, y2 } = this.walkBounds
    this.targetX = Phaser.Math.Between(x1, x2)
    this.targetY = Phaser.Math.Between(y1, y2)
  }
}
