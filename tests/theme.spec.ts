// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FabricThemeManager } from '../src/client/theme.ts'

describe('FabricThemeManager', () => {
  let manager: FabricThemeManager

  beforeEach(() => {
    manager = new FabricThemeManager()
    document.head.innerHTML = ''
    document.body.removeAttribute('data-ds-dark-theme')
    document.body.removeAttribute('data-theme')
    document.documentElement.className = ''
  })

  afterEach(() => {
    manager.dispose()
    document.head.innerHTML = ''
  })

  it('injects tokens with high-specificity selectors into document.head', () => {
    const dispose = manager.setTokens('plugin-a', {
      '--dsw-alias-bg-base': '#1e1e2e',
      'dsw-alias-label-primary': '#cdd6f4',
    })

    const styleEl = document.getElementById('fabric-theme-tokens') as HTMLStyleElement | null
    expect(styleEl).toBeTruthy()
    expect(styleEl?.textContent).toContain(':root, body, body[data-ds-dark-theme]')
    expect(styleEl?.textContent).toContain('--dsw-alias-bg-base: #1e1e2e;')
    expect(styleEl?.textContent).toContain('--dsw-alias-label-primary: #cdd6f4;')

    dispose()
    expect(document.getElementById('fabric-theme-tokens')).toBeNull()
  })

  it('supports priority arbitration across multiple plugins', () => {
    manager.setTokens('low-pri', {
      '--dsw-alias-bg-base': '#111111',
      '--dsw-brand-primary': '#00ff00',
    }, { priority: 0 })

    manager.setTokens('high-pri', {
      '--dsw-alias-bg-base': '#222222',
    }, { priority: 10 })

    const tokens = manager.getTokens('global')
    expect(tokens['--dsw-alias-bg-base']).toBe('#222222')
    expect(tokens['--dsw-brand-primary']).toBe('#00ff00')

    manager.clearTokens('high-pri')
    const rolledBack = manager.getTokens('global')
    expect(rolledBack['--dsw-alias-bg-base']).toBe('#111111')
  })

  it('generates scoped rules for workbench tokens', () => {
    manager.setTokens('wb-theme', {
      '--dsw-alias-bg-base': '#333333',
    }, { scope: 'workbench' })

    const styleEl = document.getElementById('fabric-theme-tokens')
    expect(styleEl?.textContent).toContain('[data-fabric-workbench], [data-fabric-workbench] *')
    expect(styleEl?.textContent).toContain('--dsw-alias-bg-base: #333333;')
  })

  it('detects dark mode from host body and documentElement attributes', () => {
    expect(manager.isDark()).toBe(false)

    document.body.setAttribute('data-ds-dark-theme', 'true')
    expect(manager.isDark()).toBe(true)

    document.body.removeAttribute('data-ds-dark-theme')
    document.body.setAttribute('data-theme', 'dark')
    expect(manager.isDark()).toBe(true)

    document.body.removeAttribute('data-theme')
    document.documentElement.classList.add('dark')
    expect(manager.isDark()).toBe(true)
  })

  it('notifies theme change subscribers via MutationObserver', async () => {
    const listener = vi.fn()
    const unsubscribe = manager.onThemeChange(listener)

    document.body.setAttribute('data-ds-dark-theme', 'true')

    // Wait for mutation observer microtask
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith({ dark: true })
    })

    document.body.removeAttribute('data-ds-dark-theme')

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith({ dark: false })
    })

    unsubscribe()
  })
})
