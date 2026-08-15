import type { FabricThemeService } from './contract.ts'

export interface FabricSemanticSurface {
  readonly base: string
  readonly raised: string
  readonly sunken: string
  readonly muted: string
  readonly overlay: string
}

export interface FabricSemanticContent {
  readonly primary: string
  readonly secondary: string
  readonly tertiary: string
  readonly disabled: string
  readonly inverse: string
}

export interface FabricSemanticBorder {
  readonly subtle: string
  readonly default: string
  readonly strong: string
  readonly focus: string
}

export interface FabricSemanticAccent {
  readonly primary: string
  readonly hover: string
  readonly active: string
  readonly surface: string
}

export interface FabricSemanticState {
  readonly foreground: string
  readonly surface: string
  readonly border: string
}

export interface FabricSemanticStates {
  readonly info: FabricSemanticState
  readonly success: FabricSemanticState
  readonly warning: FabricSemanticState
  readonly danger: FabricSemanticState
}

export interface FabricSemanticInteraction {
  readonly hover: string
  readonly active: string
  readonly selected: string
  readonly focus: string
}

export interface FabricSemanticMaterial {
  readonly acrylicBackground: string
  readonly acrylicFilter: string
  readonly edgeHighlight: string
  readonly shadow: string
}

export interface FabricThemeDefinition {
  readonly surface: FabricSemanticSurface
  readonly content: FabricSemanticContent
  readonly border: FabricSemanticBorder
  readonly accent: FabricSemanticAccent
  readonly state: FabricSemanticStates
  readonly interaction: FabricSemanticInteraction
  readonly material: FabricSemanticMaterial
  readonly fontFamily?: string
  readonly fontMono?: string
}

export interface FabricThemeProvider {
  provide(id: string, theme: FabricThemeDefinition, options?: { readonly priority?: number; readonly scope?: 'global' | 'workbench' }): () => void
  clear(id: string): void
  isDark(): boolean
  onChange(listener: (theme: { readonly dark: boolean }) => void): () => void
}

export function createFabricThemeProvider(theme: FabricThemeService): FabricThemeProvider {
  return {
    provide(id, definition, options) {
      return theme.setSemantic(id, definition, options)
    },
    clear(id) {
      theme.clearTokens(id)
    },
    isDark() {
      return theme.isDark()
    },
    onChange(listener) {
      return theme.onThemeChange(listener)
    },
  }
}

export function semanticThemeToCss(theme: FabricThemeDefinition): Record<string, string> {
  return {
    '--fabric-surface-base': theme.surface.base,
    '--fabric-surface-raised': theme.surface.raised,
    '--fabric-surface-sunken': theme.surface.sunken,
    '--fabric-surface-muted': theme.surface.muted,
    '--fabric-surface-overlay': theme.surface.overlay,
    '--fabric-content-primary': theme.content.primary,
    '--fabric-content-secondary': theme.content.secondary,
    '--fabric-content-tertiary': theme.content.tertiary,
    '--fabric-content-disabled': theme.content.disabled,
    '--fabric-content-inverse': theme.content.inverse,
    '--fabric-border-subtle': theme.border.subtle,
    '--fabric-border-default': theme.border.default,
    '--fabric-border-strong': theme.border.strong,
    '--fabric-border-focus': theme.border.focus,
    '--fabric-accent-primary': theme.accent.primary,
    '--fabric-accent-hover': theme.accent.hover,
    '--fabric-accent-active': theme.accent.active,
    '--fabric-accent-surface': theme.accent.surface,
    '--fabric-state-info-foreground': theme.state.info.foreground,
    '--fabric-state-info-surface': theme.state.info.surface,
    '--fabric-state-info-border': theme.state.info.border,
    '--fabric-state-success-foreground': theme.state.success.foreground,
    '--fabric-state-success-surface': theme.state.success.surface,
    '--fabric-state-success-border': theme.state.success.border,
    '--fabric-state-warning-foreground': theme.state.warning.foreground,
    '--fabric-state-warning-surface': theme.state.warning.surface,
    '--fabric-state-warning-border': theme.state.warning.border,
    '--fabric-state-danger-foreground': theme.state.danger.foreground,
    '--fabric-state-danger-surface': theme.state.danger.surface,
    '--fabric-state-danger-border': theme.state.danger.border,
    '--fabric-interaction-hover': theme.interaction.hover,
    '--fabric-interaction-active': theme.interaction.active,
    '--fabric-interaction-selected': theme.interaction.selected,
    '--fabric-interaction-focus': theme.interaction.focus,
    '--fabric-material-acrylic-background': theme.material.acrylicBackground,
    '--fabric-material-acrylic-filter': theme.material.acrylicFilter,
    '--fabric-material-edge-highlight': theme.material.edgeHighlight,
    '--fabric-material-shadow': theme.material.shadow,
    ...(theme.fontFamily === undefined ? {} : { '--fabric-font-family': theme.fontFamily }),
    ...(theme.fontMono === undefined ? {} : { '--fabric-font-mono': theme.fontMono }),
  }
}
