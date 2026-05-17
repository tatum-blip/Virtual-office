export const DAILY_DOMAIN = process.env.NEXT_PUBLIC_DAILY_DOMAIN ?? ''

export function getRoomUrl(roomName: string): string {
  return `https://${DAILY_DOMAIN}.daily.co/${roomName}`
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}
