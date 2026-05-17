import type Phaser from 'phaser'

let gameInstance: Phaser.Game | null = null

export async function createGame(
  parent: string,
  sceneData: Record<string, unknown>
): Promise<Phaser.Game> {
  const [{ default: PhaserLib }, { PreloadScene }, { OfficeScene }, { buildGameConfig }] =
    await Promise.all([
      import('phaser'),
      import('./scenes/PreloadScene'),
      import('./scenes/OfficeScene'),
      import('./config/gameConfig'),
    ])

  if (gameInstance) {
    gameInstance.destroy(true)
    gameInstance = null
  }

  const config = buildGameConfig(parent)

  gameInstance = new PhaserLib.Game({
    ...config,
    scene: [PreloadScene, OfficeScene],
  })

  // Pass sceneData to PreloadScene which forwards it to OfficeScene after assets load
  gameInstance.events.on('ready', () => {
    gameInstance?.scene.start('PreloadScene', sceneData)
  })

  return gameInstance
}

export function destroyGame() {
  if (gameInstance) {
    gameInstance.destroy(true)
    gameInstance = null
  }
}
