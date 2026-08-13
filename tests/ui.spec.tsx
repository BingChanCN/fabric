// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AsyncView, EmptyState, Page, PageHeader, Section } from '../src/ui/index.tsx'
import type { AsyncResourceSnapshot } from '../src/sdk/resource.ts'

const snapshot = <T,>(patch: Partial<AsyncResourceSnapshot<T>>): AsyncResourceSnapshot<T> => ({
  status: 'idle',
  value: undefined,
  hasValue: false,
  error: undefined,
  refreshing: false,
  revision: 0,
  ...patch,
})

describe('Fabric UI', () => {
  it('renders the standard page hierarchy', () => {
    render(
      <Page>
        <PageHeader title="Memory" description="Long-term context" />
        <Section title="Recent"><span>Item</span></Section>
      </Page>,
    )
    expect(screen.getByRole('heading', { name: 'Memory' })).toBeTruthy()
    expect(screen.getByText('Long-term context')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeTruthy()
  })

  it('switches async loading, error, empty and value states', () => {
    const { rerender } = render(
      <AsyncView snapshot={snapshot<string[]>({ status: 'loading' })} loadingLabel="Fetching">
        {value => <span>{value.length}</span>}
      </AsyncView>,
    )
    expect(screen.getByText('Fetching')).toBeTruthy()

    rerender(
      <AsyncView snapshot={snapshot<string[]>({ status: 'error', error: new Error('offline') })}>
        {value => <span>{value.length}</span>}
      </AsyncView>,
    )
    expect(screen.getByRole('alert').textContent).toContain('offline')

    rerender(
      <AsyncView
        snapshot={snapshot<string[]>({ status: 'ready', value: [], hasValue: true })}
        isEmpty={value => value.length === 0}
        empty={<EmptyState title="Nothing here" />}
      >
        {value => <span>{value.length}</span>}
      </AsyncView>,
    )
    expect(screen.getByText('Nothing here')).toBeTruthy()

    rerender(
      <AsyncView snapshot={snapshot<string[]>({ status: 'ready', value: ['one'], hasValue: true })}>
        {value => <span>Count: {value.length}</span>}
      </AsyncView>,
    )
    expect(screen.getByText('Count: 1')).toBeTruthy()
  })
})
