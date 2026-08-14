import { useMemo, useState } from 'react'
import { createJsonClient, createAsyncResource } from 'fabric/sdk'
import {
  AsyncView, Badge, Dropdown, EmptyState, Modal, Page, PageHeader, Popover, Section,
  useAsyncResource, useFabricConfig,
} from 'fabric/ui'
import type { FabricPageProps } from 'fabric/client'
import css from './example.module.css'

type StatusPayload = {
  readonly status: 'ok'
  readonly sessionId?: string
}

export function ExamplePage({ sessionId, openFabric, notify }: FabricPageProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const config = useFabricConfig<{ enabled: boolean }>('hello-fabric')
  const resource = useMemo(() => createAsyncResource<StatusPayload>(async signal => {
    const client = createJsonClient({ sessionId: () => sessionId })
    return client.get<StatusPayload>('/fabric-example/status', { signal })
  }), [sessionId])
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
      <Section title="Persisted config" description="useFabricConfig reads the schema store; edits debounce to /fabric/config/hello-fabric.">
        <label className={css.row}>
          <input
            type="checkbox"
            checked={config.values.enabled === true}
            onChange={event => { config.set({ enabled: event.target.checked }) }}
          />
          <span>Enabled ({config.dirty ? 'unsaved' : config.status})</span>
        </label>
      </Section>
      <Section title="Current session" description="The host supplies this value through the session-maybe standard kit.">
        <div className={css.row}>
          <Badge tone={sessionId === undefined ? 'warning' : 'success'}>
            {sessionId === undefined ? 'No session selected' : sessionId}
          </Badge>
          <button type="button" className={css.linkButton} onClick={() => openFabric()}>Keep Fabric open</button>
        </div>
      </Section>
      <Section title="UI Primitives & Overlays" description="Interact with built-in Modal, Dropdown and Popover components.">
        <div className={css.row}>
          <button type="button" className={css.button} onClick={() => { setModalOpen(true) }}>
            Open Demo Modal
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
        <Modal
          open={modalOpen}
          onClose={() => { setModalOpen(false) }}
          title="Fabric Interactive Modal"
          description="A standard modal dialog with ESC closing, focus trap and backdrop mask."
          footer={
            <button type="button" className={css.button} onClick={() => { setModalOpen(false) }}>
              Close Modal
            </button>
          }
        >
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
            This modal is rendered through a dedicated <code>Portal</code> and follows Fabric elevation standards.
          </p>
        </Modal>
      </Section>
      <Section title="Request lifecycle" description="AsyncResource cancels stale requests and keeps refresh state stable.">
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
