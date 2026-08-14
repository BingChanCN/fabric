// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { FabricCommandRegistry } from '../src/client/commands.ts'
import { formatShortcut, matchShortcut, parseShortcut } from '../src/client/shortcut.ts'

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('shortcuts', () => {
  it('treats Mod as Ctrl on non-Mac platforms', () => {
    expect(parseShortcut('Mod+Shift+K')).toMatchObject({ mod: true, shift: true, key: 'k' })
    expect(matchShortcut(keyEvent({ key: 'k', ctrlKey: true, shiftKey: true }), 'Mod+Shift+K', 'Win32')).toBe(true)
    expect(matchShortcut(keyEvent({ key: 'k', metaKey: true, shiftKey: true }), 'Mod+Shift+K', 'Win32')).toBe(false)
    expect(matchShortcut(keyEvent({ key: 'k', metaKey: true, shiftKey: true }), 'Mod+Shift+K', 'MacIntel')).toBe(true)
  })

  it('formats a readable chord', () => {
    expect(formatShortcut('Mod+K', 'Win32')).toBe('Ctrl+K')
    expect(formatShortcut('Mod+K', 'MacIntel')).toBe('⌘K')
  })
})

describe('FabricCommandRegistry', () => {
  it('executes a command, lists it, and releases it on dispose', () => {
    const registry = new FabricCommandRegistry()
    const handler = vi.fn()
    const stop = registry.register({
      id: 'demo.ping',
      title: 'Ping',
      shortcut: 'Mod+Shift+P',
      handler,
    })
    expect(registry.list().map(command => command.id)).toEqual(['demo.ping'])
    expect(registry.execute('demo.ping')).toBe(true)
    expect(handler).toHaveBeenCalledOnce()
    stop()
    expect(registry.list()).toEqual([])
    expect(registry.execute('demo.ping')).toBe(false)
    registry.dispose()
  })

  it('dispatches a matching window shortcut', () => {
    const registry = new FabricCommandRegistry()
    const handler = vi.fn()
    registry.register({ id: 'demo.open', title: 'Open', shortcut: 'Mod+K', handler })
    const stop = registry.start()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    expect(handler).toHaveBeenCalledOnce()
    stop()
    registry.dispose()
  })
})
