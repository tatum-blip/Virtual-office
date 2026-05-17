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

  // Create the game with NO auto-started scenes — we manually start PreloadScene
  // with the proper data once the game is ready. This avoids a race where Phaser
  // auto-starts PreloadScene with empty data before our 'ready' handler fires.
  gameInstance = new PhaserLib.Game({
    ...config,
    scene: [],
  })

  const game = gameInstance
  game.scene.add('PreloadScene', PreloadScene, false)
  game.scene.add('OfficeScene', OfficeScene, false)

  const startOnce = () => {
    game.scene.start('PreloadScene', sceneData)
  }
  if (game.isBooted) {
    startOnce()
  } else {
    game.events.once('ready', startOnce)
  }

  return gameInstance
}

export function destroyGame() {
  if (gameInstance) {
    gameInstance.destroy(true)
    gameInstance = null
  }
}
