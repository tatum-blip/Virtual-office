import type { Types } from 'phaser'

export const TILE_SIZE = 32
export const MAP_WIDTH = 52   // 1664px — Kumospace-style large floor
export const MAP_HEIGHT = 30  // 960px

export const GAME_WIDTH = MAP_WIDTH * TILE_SIZE
export const GAME_HEIGHT = MAP_HEIGHT * TILE_SIZE

export const VIEWPORT_WIDTH = typeof window !== 'undefined' ? window.innerWidth : 1280
export const VIEWPORT_HEIGHT = typeof window !== 'undefined' ? window.innerHeight - 64 : 720

export function buildGameConfig(parent: string): Types.Core.GameConfig {
  return {
    type: 2, // Phaser.AUTO
    parent,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    backgroundColor: '#0f0f1a',
    physics: {
      default: 'arcade',
      arcade: { debug: false },
    },
    scale: {
      mode: 5, // Phaser.Scale.RESIZE
      autoCenter: 1,
    },
    pixelArt: false,
    antialias: true,
    roundPixels: false,
  }
}
