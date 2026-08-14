import { useMemo } from 'react'
import { createJsonClient, createAsyncResource } from 'fabric/sdk'
import { AsyncView, Badge, EmptyState, Page, PageHeader, Section, useAsyncResource } from 'fabric/ui'
import type { FabricPageProps } from 'fabric/client'
import css from './example.module.css'

type StatusPayload = {
  readonly status: 'ok'
  readonly sessionId?: string
}

export function ExamplePage({ sessionId, openFabric, notify }: FabricPageProps) {
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
      <Section title="Current session" description="The host supplies this value through the session-maybe standard kit.">
        <div className={css.row}>
          <Badge tone={sessionId === undefined ? 'warning' : 'success'}>
            {sessionId === undefined ? 'No session selected' : sessionId}
          </Badge>
          <button type="button" className={css.linkButton} onClick={() => openFabric()}>Keep Fabric open</button>
        </div>
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
