import { useState } from 'react'
import { BoundConfigForm, EmptyState, Page, PageHeader, Section, useObservable } from '../../ui/index.tsx'
import { getConfigRuntime } from '../../sdk/config.ts'
import type {
  FabricConfigRecord, FabricPageRecord, FabricThemeRecord,
} from '../../sdk/config.ts'
import type { FabricPageProps } from '../contract.ts'
import type { FabricOperationDefinition } from '../../operation/contract.ts'
import type { FabricOperationClient } from '../operations.ts'
import { getFabricRuntimeClient } from '../runtime.ts'
import {
  fabricDisablePackageOperation, fabricEnablePackageOperation, fabricInstallPackageOperation,
  fabricPurgePackageOperation, fabricRemovePackageOperation, fabricRollbackPackageOperation,
  fabricUpdatePackageOperation,
} from '../../runtime/control.ts'
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

function publisherIdentity(packageName: string): string {
  if (packageName.startsWith('@') && packageName.includes('/')) return packageName.slice(0, packageName.indexOf('/'))
  return label('mods.unscoped')
}

interface ModMenuProps extends FabricPageProps {
  readonly operations: FabricOperationClient
}

/** Built-in catalog and control surface for Fabric Runtime Packages and contributions. */
export function ModMenu({ openFabric, notify, operations }: ModMenuProps) {
  const catalog = useObservable(getConfigRuntime())
  const runtime = getFabricRuntimeClient()
  const runtimeStates = useObservable(runtime)
  const inventory = runtime.getInventory()
  const [installPath, setInstallPath] = useState('')
  const [busy, setBusy] = useState<string | undefined>()
  const [operationError, setOperationError] = useState<string | undefined>()
  const run = async <Input, Result, Progress>(
    key: string,
    operation: FabricOperationDefinition<Input, Result, Progress>,
    input: Input,
  ): Promise<void> => {
    setBusy(key)
    setOperationError(undefined)
    try {
      const handle = await operations.start(operation, input)
      await handle.result()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setOperationError(message)
      notify(message, { tone: 'error' })
    } finally {
      setBusy(undefined)
    }
  }
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
      <Section title={label('mods.runtime')}>
        <form className={css.install} onSubmit={event => {
          event.preventDefault()
          if (installPath.trim() !== '') void run('install', fabricInstallPackageOperation, { source: installPath.trim() })
        }}>
          <input
            className={css.path}
            value={installPath}
            onChange={event => { setInstallPath(event.target.value) }}
            placeholder={label('mods.installPath')}
            aria-label={label('mods.installPath')}
          />
          <button className={css.command} type="submit" disabled={busy !== undefined || installPath.trim() === ''}>
            {label('mods.install')}
          </button>
        </form>
        <p className={css.trust}>{label('mods.trust')}</p>
        {operationError !== undefined && <p className={css.error} role="alert">{operationError}</p>}
        <div className={css.packages}>
          {Object.entries(inventory.plugins).map(([name, entry]) => {
            const state = runtimeStates.find(item => item.packageName === name)
            const status = state?.status === 'failed'
              ? label('mods.failed')
              : state?.status === 'loading'
                ? label('mods.loading')
                : entry.enabled ? label('mods.active') : label('mods.inactive')
            const isBusy = busy === name || busy === 'install'
            return (
              <div className={css.package} key={name}>
                <div className={css.packageIdentity}>
                  <strong>{name}</strong>
                  <span className={css.meta}>{entry.version} · {status}</span>
                  <span className={css.packageDetails}>
                    {label('mods.publisher')}: {publisherIdentity(name)} · {label('mods.source')}: {entry.source}
                  </span>
                  {entry.previous !== undefined && <span className={css.meta}>{label('mods.previous')} {entry.previous.version}</span>}
                  {state?.error !== undefined && <span className={css.error}>{state.error}</span>}
                </div>
                <div className={css.packageActions}>
                  <button className={css.command} type="button" disabled={isBusy} onClick={() => {
                    void run(name, fabricUpdatePackageOperation, { name })
                  }}>{label('mods.update')}</button>
                  {state?.status === 'failed' && (
                    <button className={css.command} type="button" disabled={isBusy} onClick={() => { void runtime.retry(name) }}>
                      {label('mods.retry')}
                    </button>
                  )}
                  <button className={css.command} type="button" disabled={isBusy} onClick={() => {
                    void run(name, entry.enabled ? fabricDisablePackageOperation : fabricEnablePackageOperation, { name })
                  }}>
                    {entry.enabled ? label('mods.disable') : label('mods.enable')}
                  </button>
                  {entry.previous !== undefined && (
                    <button className={css.command} type="button" disabled={isBusy} onClick={() => {
                      void run(name, fabricRollbackPackageOperation, { name })
                    }}>{label('mods.rollback')}</button>
                  )}
                  <button className={css.command} type="button" disabled={isBusy} onClick={() => {
                    void run(name, fabricRemovePackageOperation, { name })
                  }}>{label('mods.remove')}</button>
                  <button className={`${css.command} ${css.danger}`} type="button" disabled={isBusy} onClick={() => {
                    void run(name, fabricPurgePackageOperation, { name })
                  }}>{label('mods.purge')}</button>
                </div>
              </div>
            )
          })}
        </div>
      </Section>
      {cards.length === 0 && Object.keys(inventory.plugins).length === 0 ? (
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
