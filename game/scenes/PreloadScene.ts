import Phaser from 'phaser'

export class PreloadScene extends Phaser.Scene {
  private officeSceneData: Record<string, unknown> = {}

  constructor() {
    super({ key: 'PreloadScene' })
  }

  init(data: Record<string, unknown>) {
    this.officeSceneData = data
  }

  preload() {
    this.load.on('progress', (value: number) => {
      const pct = Math.round(value * 100)
      const el = document.getElementById('loading-pct')
      if (el) el.textContent = `${pct}%`
    })

    // Office floor tileset (procedurally generated if PNG not present)
    this.load.image('tiles', '/assets/tilemaps/tileset.png')
    this.load.tilemapTiledJSON('office', '/assets/tilemaps/office.json')

    // Agent creature spritesheet — 8 frames in a row, 32x32 each
    this.load.spritesheet('creatures', '/assets/sprites/agent-creatures.png', {
      frameWidth: 32,
      frameHeight: 32,
    })

    // User avatar spritesheet — 8 avatars, 32x32 each
    this.load.spritesheet('avatars', '/assets/sprites/avatars.png', {
      frameWidth: 32,
      frameHeight: 48,
    })
  }

  create() {
    this.createCreatureAnimations()
    this.createAvatarAnimations()
    this.scene.start('OfficeScene', this.officeSceneData)
  }

  private createCreatureAnimations() {
    for (let i = 0; i < 8; i++) {
      const key = `creature_walk_${i}`
      if (!this.anims.exists(key)) {
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers('creatures', {
            start: i * 4,
            end: i * 4 + 3,
          }),
          frameRate: 6,
          repeat: -1,
        })
      }
      const idleKey = `creature_idle_${i}`
      if (!this.anims.exists(idleKey)) {
        this.anims.create({
          key: idleKey,
          frames: [{ key: 'creatures', frame: i * 4 }],
          frameRate: 1,
          repeat: -1,
        })
      }
    }
  }

  private createAvatarAnimations() {
    for (let i = 0; i < 8; i++) {
      const walkKey = `avatar_walk_${i}`
      if (!this.anims.exists(walkKey)) {
        this.anims.create({
          key: walkKey,
          frames: this.anims.generateFrameNumbers('avatars', {
            start: i * 4,
            end: i * 4 + 3,
          }),
          frameRate: 8,
          repeat: -1,
        })
      }
      const idleKey = `avatar_idle_${i}`
      if (!this.anims.exists(idleKey)) {
        this.anims.create({
          key: idleKey,
          frames: [{ key: 'avatars', frame: i * 4 }],
          frameRate: 1,
          repeat: -1,
        })
      }
    }
  }
}
