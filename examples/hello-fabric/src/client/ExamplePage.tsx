import { useMemo } from 'react'
import { createAsyncResource } from '@dsh-do/fabric/sdk'
import {
  AsyncView, Badge, Dropdown, EmptyState, Page, PageHeader, Popover, Section,
  useAsyncResource, useFabricConfig,
} from '@dsh-do/fabric/ui'
import type { FabricDialogContentProps, FabricPageProps } from '@dsh-do/fabric/client'
import { statusResource, type ExampleStatus } from '../resources.ts'
import css from './example.module.css'

function DemoDialog({ dialog }: FabricDialogContentProps) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
        This dialog is owned by the page scope and closes automatically when that page unmounts.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className={css.button} onClick={dialog.close}>Close Dialog</button>
      </div>
    </div>
  )
}

export function ExamplePage({ page, sessionId, resources, config: getConfig, openFabric, notify }: FabricPageProps) {
  const config = useFabricConfig<{ enabled: boolean }>(getConfig('dsh-do.hello-fabric.preferences'))
  const resource = useMemo(() => createAsyncResource<ExampleStatus>(async signal => {
    if (sessionId === undefined) throw new Error('select a session before querying status')
    return resources.read(statusResource, undefined, { signal, session: { id: sessionId } })
  }), [resources, sessionId])
  const snapshot = useAsyncResource(resource, { load: false })

  const loadStatus = (): void => {
    void resource.load().then(result => {
      if (result.status === 'ready') notify('Session endpoint responded', { tone: 'success' })
    })
  }

  return (
    <Page>
      <PageHeader
        title="Hello Fabric"
        description="A small downstream plugin using Fabric's page and SDK contracts."
        actions={<button type="button" className={css.button} onClick={loadStatus}>Check session API</button>}
      />
      <Section title="Persisted config" description="useFabricConfig reads the typed Fabric config handle.">
        <label className={css.row}>
          <input
            type="checkbox"
            checked={config.values.enabled === true}
            onChange={event => { config.set({ enabled: event.target.checked }) }}
          />
          <span>Enabled ({config.dirty ? 'unsaved' : config.status})</span>
        </label>
      </Section>
      <Section title="Current session" description="The page context provides an explicit session reference.">
        <div className={css.row}>
          <Badge tone={sessionId === undefined ? 'warning' : 'success'}>
            {sessionId === undefined ? 'No session selected' : sessionId}
          </Badge>
          <button type="button" className={css.linkButton} onClick={() => openFabric()}>Keep Fabric open</button>
        </div>
      </Section>
      <Section title="Dialogs and anchored controls" description="Open a service-owned dialog or use anchored Dropdown and Popover components.">
        <div className={css.row}>
          <button
            type="button"
            className={css.button}
            onClick={() => {
              page.dialogs.open({
                id: 'demo',
                title: 'Fabric Dialog Service',
                description: 'Opened imperatively without local React state.',
                content: DemoDialog,
              })
            }}
          >
            Open Demo Dialog
          </button>
          <Dropdown
            trigger={<button type="button" className={css.button}>Dropdown Menu ▾</button>}
            items={[
              { id: 'item1', label: 'Action 1', onClick: () => notify('Action 1 clicked', { tone: 'info' }) },
              { id: 'item2', label: 'Success Notice', onClick: () => notify('Operation succeeded', { tone: 'success' }) },
              { id: 'item3', label: 'Disabled Item', disabled: true },
              { id: 'item4', label: 'Danger Action', danger: true, onClick: () => notify('Danger triggered', { tone: 'warning' }) },
            ]}
          />
          <Popover
            trigger={<button type="button" className={css.button}>Info Popover</button>}
            content={<div style={{ maxWidth: 200, fontSize: 13 }}>This is a floating popover anchored to the trigger button.</div>}
          />
        </div>
      </Section>
      <Section title="Request lifecycle" description="The typed Resource client owns transport and cancellation.">
        <AsyncView
          snapshot={snapshot}
          empty={<EmptyState title="No request yet" description="Run the session API check to populate this view." />}
          isEmpty={value => value.status !== 'ok'}
          onRetry={loadStatus}
          retryLabel="Retry"
        >
          {value => <div className={css.result}>Connected for session: {value.sessionId ?? 'global endpoint'}</div>}
        </AsyncView>
      </Section>
    </Page>
  )
}
