import type { FabricThemeService, FabricThemeSetOptions } from './contract.ts'

interface TokenEntry {
  readonly id: string
  readonly tokens: Record<string, string>
  readonly priority: number
  readonly scope: 'global' | 'workbench'
  readonly sequence: number
}

const STYLE_ELEMENT_ID = 'fabric-theme-tokens'

function formatRules(selector: string, tokens: Record<string, string>): string {
  const entries = Object.entries(tokens)
  if (entries.length === 0) return ''
  const declarations = entries
    .map(([key, value]) => `  ${key.startsWith('--') ? key : `--${key}`}: ${value};`)
    .join('\n')
  return `${selector} {\n${declarations}\n}`
}

/**
 * Manages theme token overrides across multiple plugins with priority
 * arbitration, automatic head stylesheet synchronization, and dark mode
 * change observation.
 */
export class FabricThemeManager implements FabricThemeService {
  private readonly entries = new Map<string, TokenEntry>()
  private readonly themeListeners = new Set<(theme: { dark: boolean }) => void>()
  private sequenceCounter = 0
  private observer: MutationObserver | undefined
  private mediaQuery: MediaQueryList | undefined
  private mediaListener: (() => void) | undefined
  private lastDark: boolean | undefined

  setTokens(id: string, tokens: Record<string, string>, options: FabricThemeSetOptions = {}): () => void {
    const trimmed = id.trim()
    if (trimmed === '') throw new Error('fabric: theme token set requires a non-empty id')

    const cleanTokens: Record<string, string> = {}
    for (const [key, value] of Object.entries(tokens)) {
      if (typeof key === 'string' && typeof value === 'string' && key.trim() !== '' && value.trim() !== '') {
        cleanTokens[key.trim()] = value.trim()
      }
    }

    const priority = Number.isFinite(options.priority) ? (options.priority as number) : 0
    const scope = options.scope === 'workbench' ? 'workbench' : 'global'

    this.entries.set(trimmed, {
      id: trimmed,
      tokens: cleanTokens,
      priority,
      scope,
      sequence: ++this.sequenceCounter,
    })

    this.applyToDom()

    return () => {
      this.clearTokens(trimmed)
    }
  }

  clearTokens(id: string): void {
    const trimmed = id.trim()
    if (this.entries.delete(trimmed)) {
      this.applyToDom()
    }
  }

  getTokens(scope?: 'global' | 'workbench'): Record<string, string> {
    const targetScope = scope ?? 'global'
    const sorted = [...this.entries.values()]
      .filter(entry => entry.scope === targetScope)
      .sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)

    const merged: Record<string, string> = {}
    for (const entry of sorted) {
      Object.assign(merged, entry.tokens)
    }
    return merged
  }

  isDark(): boolean {
    if (typeof document === 'undefined') return false
    const body = document.body
    if (body) {
      if (body.hasAttribute('data-ds-dark-theme')) return true
      const themeAttr = body.getAttribute('data-theme')
      if (themeAttr === 'dark') return true
    }
    const docEl = document.documentElement
    if (docEl?.classList.contains('dark')) return true
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return true
    }
    return false
  }

  onThemeChange(listener: (theme: { dark: boolean }) => void): () => void {
    this.themeListeners.add(listener)
    this.ensureThemeObserver()
    return () => {
      this.themeListeners.delete(listener)
      if (this.themeListeners.size === 0) {
        this.teardownThemeObserver()
      }
    }
  }

  dispose(): void {
    this.entries.clear()
    this.themeListeners.clear()
    this.teardownThemeObserver()
    if (typeof document !== 'undefined') {
      const el = document.getElementById(STYLE_ELEMENT_ID)
      el?.remove()
    }
  }

  private applyToDom(): void {
    if (typeof document === 'undefined') return

    const globalTokens = this.getTokens('global')
    const workbenchTokens = this.getTokens('workbench')

    const hasTokens = Object.keys(globalTokens).length > 0 || Object.keys(workbenchTokens).length > 0
    let styleEl = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null

    if (!hasTokens) {
      styleEl?.remove()
      return
    }

    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = STYLE_ELEMENT_ID
      styleEl.setAttribute('data-fabric-theme', 'true')
      document.head?.appendChild(styleEl)
    }

    const cssRules: string[] = []

    if (Object.keys(globalTokens).length > 0) {
      // High-specificity selector matching DSH host root and body dark variants
      cssRules.push(formatRules(':root, body, body[data-ds-dark-theme]', globalTokens))
    }

    if (Object.keys(workbenchTokens).length > 0) {
      cssRules.push(formatRules('[data-fabric-workbench], [data-fabric-workbench] *', workbenchTokens))
    }

    styleEl.textContent = cssRules.join('\n\n')
  }

  private ensureThemeObserver(): void {
    if (typeof document === 'undefined') return
    if (this.observer !== undefined) return

    this.lastDark = this.isDark()

    const check = (): void => {
      const current = this.isDark()
      if (current !== this.lastDark) {
        this.lastDark = current
        for (const listener of this.themeListeners) {
          try {
            listener({ dark: current })
          } catch {
            // Ignore subscriber errors
          }
        }
      }
    }

    if (typeof MutationObserver !== 'undefined' && document.body) {
      this.observer = new MutationObserver(() => { check() })
      this.observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['data-ds-dark-theme', 'data-theme', 'class'],
      })
      if (document.documentElement) {
        this.observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-theme', 'class'],
        })
      }
    }

    if (typeof window !== 'undefined' && window.matchMedia) {
      try {
        this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        this.mediaListener = () => { check() }
        this.mediaQuery.addEventListener?.('change', this.mediaListener)
      } catch {
        // matchMedia optional
      }
    }
  }

  private teardownThemeObserver(): void {
    this.observer?.disconnect()
    this.observer = undefined
    if (this.mediaQuery && this.mediaListener) {
      this.mediaQuery.removeEventListener?.('change', this.mediaListener)
      this.mediaQuery = undefined
      this.mediaListener = undefined
    }
  }
}
