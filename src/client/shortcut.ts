export interface ParsedShortcut {
  mod: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  key: string
}

const NAMED_KEYS: Record<string, string> = {
  esc: 'escape',
  escape: 'escape',
  enter: 'enter',
  return: 'enter',
  space: ' ',
  spacebar: ' ',
  tab: 'tab',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
}

/** Parse a Fabric shortcut spec such as `Mod+Shift+K`. */
export function parseShortcut(spec: string): ParsedShortcut {
  const parts = spec.split('+').map(part => part.trim()).filter(part => part !== '')
  if (parts.length === 0) throw new Error('shortcut is empty')
  const rawKey = parts[parts.length - 1]!.toLowerCase()
  const key = NAMED_KEYS[rawKey] ?? rawKey
  const mods = new Set(parts.slice(0, -1).map(part => part.toLowerCase()))
  return {
    mod: mods.has('mod'),
    ctrl: mods.has('ctrl') || mods.has('control'),
    meta: mods.has('meta') || mods.has('cmd') || mods.has('command'),
    alt: mods.has('alt') || mods.has('option'),
    shift: mods.has('shift'),
    key,
  }
}

export function isMacPlatform(platform = typeof navigator === 'undefined' ? '' : navigator.platform): boolean {
  return /Mac|iPhone|iPad|iPod/.test(platform)
}

export function matchShortcut(
  event: KeyboardEvent,
  spec: string,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
): boolean {
  const parsed = parseShortcut(spec)
  const mac = isMacPlatform(platform)
  const wantCtrl = parsed.ctrl || (parsed.mod && !mac)
  const wantMeta = parsed.meta || (parsed.mod && mac)
  if (event.ctrlKey !== wantCtrl) return false
  if (event.metaKey !== wantMeta) return false
  if (event.altKey !== parsed.alt) return false
  if (event.shiftKey !== parsed.shift) return false
  return event.key.toLowerCase() === parsed.key
}

export function formatShortcut(
  spec: string,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
): string {
  const parsed = parseShortcut(spec)
  const mac = isMacPlatform(platform)
  const tokens: string[] = []
  if (parsed.mod) tokens.push(mac ? '⌘' : 'Ctrl')
  if (parsed.ctrl && !parsed.mod) tokens.push('Ctrl')
  if (parsed.meta && !parsed.mod) tokens.push(mac ? '⌘' : 'Meta')
  if (parsed.alt) tokens.push(mac ? '⌥' : 'Alt')
  if (parsed.shift) tokens.push(mac ? '⇧' : 'Shift')
  const keyLabel = parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key
  tokens.push(keyLabel)
  return tokens.join(mac ? '' : '+')
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
