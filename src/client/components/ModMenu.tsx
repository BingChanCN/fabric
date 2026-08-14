import { BoundConfigForm, EmptyState, Page, PageHeader, Section, useObservable } from '../../ui/index.tsx'
import { getConfigRuntime } from '../../sdk/config.ts'
import type {
  FabricConfigRecord, FabricPageRecord, FabricThemeRecord,
} from '../../sdk/config.ts'
import type { FabricPageProps } from '../contract.ts'
import { en, zh } from '../locales.ts'
import type { FabricLocaleKey } from '../locales.ts'
import css from './ModMenu.module.css'

const SYSTEM_PAGE = 'fabric:mods'

interface ModCard {
  id: string
  name: string
  version?: string
  description?: string
  icon?: unknown
  pages: FabricPageRecord[]
  configs: FabricConfigRecord[]
  themes: FabricThemeRecord[]
}

function label(key: FabricLocaleKey): string {
  const lang = typeof document === 'undefined' ? 'en' : document.documentElement.lang
  return (lang.startsWith('zh') ? zh : en)[key]
}

/** Built-in catalog of Fabric mods, pages, configs, and themes. */
export function ModMenu({ openFabric }: FabricPageProps) {
  const catalog = useObservable(getConfigRuntime())
  const userPages = catalog.pages.filter(page => page.id !== SYSTEM_PAGE)
  const groups = new Map<string, ModCard>()

  for (const mod of catalog.mods) {
    groups.set(mod.id, {
      id: mod.id,
      name: mod.name,
      ...(mod.version !== undefined ? { version: mod.version } : {}),
      ...(mod.description !== undefined ? { description: mod.description } : {}),
      ...(mod.icon !== undefined ? { icon: mod.icon } : {}),
      pages: [],
      configs: [],
      themes: [],
    })
  }

  const ungrouped: ModCard = {
    id: '',
    name: label('mods.ungrouped'),
    pages: [],
    configs: [],
    themes: [],
  }

  for (const page of userPages) {
    const group = page.pluginId !== undefined ? groups.get(page.pluginId) : undefined
    ;(group ?? ungrouped).pages.push(page)
  }
  for (const config of catalog.configs) {
    const group = config.pluginId !== undefined ? groups.get(config.pluginId) : undefined
    ;(group ?? ungrouped).configs.push(config)
  }
  for (const theme of catalog.themes) {
    const group = theme.pluginId !== undefined ? groups.get(theme.pluginId) : undefined
    ;(group ?? ungrouped).themes.push(theme)
  }

  const cards = [
    ...groups.values(),
    ...(ungrouped.pages.length + ungrouped.configs.length + ungrouped.themes.length > 0 ? [ungrouped] : []),
  ]

  return (
    <Page>
      <PageHeader title={label('mods.title')} description={label('mods.description')} />
      {cards.length === 0 ? (
        <EmptyState title={label('mods.empty')} />
      ) : cards.map(card => (
        <Section
          key={card.id || 'ungrouped'}
          title={card.name}
          {...(card.description !== undefined ? { description: card.description } : {})}
          actions={card.version !== undefined ? <span className={css.version}>{label('mods.version')} {card.version}</span> : undefined}
        >
          {card.pages.length > 0 && (
            <div className={css.row}>
              <strong className={css.label}>{label('mods.pages')}</strong>
              {card.pages.map(page => (
                <button key={page.id} type="button" className={css.link} onClick={() => { openFabric(page.id) }}>
                  {page.label}
                </button>
              ))}
            </div>
          )}
          {card.themes.length > 0 && (
            <div className={css.row}>
              <strong className={css.label}>{label('mods.themes')}</strong>
              <span className={css.meta}>{card.themes.map(theme => theme.id).join(', ')}</span>
            </div>
          )}
          {card.configs.map(config => {
            const store = getConfigRuntime().getStore(config.id)
            if (store === undefined) return null
            return (
              <div key={config.id} className={css.config}>
                <div className={css.configHeader}>
                  <strong>{config.title}</strong>
                  {config.description !== undefined && <span className={css.meta}>{config.description}</span>}
                </div>
                <BoundConfigForm store={store} />
              </div>
            )
          })}
        </Section>
      ))}
    </Page>
  )
}
