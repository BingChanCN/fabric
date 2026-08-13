import { useEffect, useId, useRef, useState } from 'react'
import {
  IconCheckOutline16, IconCloseOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FabricNoticeTone } from '../contract.ts'
import type { WorkbenchProps } from './props.ts'
import css from './Workbench.module.css'

function NoticeIcon({ tone }: { tone: FabricNoticeTone }) {
  if (tone === 'success') return <IconCheckOutline16 size={16} />
  if (tone === 'warning' || tone === 'error') return <IconWarningOutline16 size={16} />
  return null
}

/** Fabric's resident workbench, page router, extension overlay, and notice host. */
export function Workbench({
  renderSlot,
  useFabric,
  closeFabric,
  openFabric,
  notify,
  dismissNotice,
  t,
}: WorkbenchProps) {
  const titleId = useId()
  const snapshot = useFabric(value => value)
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set())
  const dialog = useRef<HTMLDivElement | null>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const active = snapshot.activePage
    if (active === undefined) return
    setVisited(previous => previous.has(active) ? previous : new Set([...previous, active]))
  }, [snapshot.activePage])

  useEffect(() => {
    setVisited(previous => {
      const live = new Set(snapshot.pages.map(page => page.id))
      if ([...previous].every(id => live.has(id))) return previous
      return new Set([...previous].filter(id => live.has(id)))
    })
  }, [snapshot.pages])

  useEffect(() => {
    if (!snapshot.open) return
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeFabric()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      restoreFocus.current?.focus()
      restoreFocus.current = null
    }
  }, [closeFabric, snapshot.open])

  const owner = { closeFabric, openFabric, notify }
  const active = snapshot.pages.find(page => page.id === snapshot.activePage)

  return (
    <div className={css.host} data-open={snapshot.open || undefined}>
      {snapshot.open && (
        <>
          <button type="button" className={css.mask} aria-label={t('close')} onClick={closeFabric} />
          <div
            ref={dialog}
            className={css.drawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <header className={css.header}>
              <div className={css.identity}>
                <span className={css.brand}>{t('name')}</span>
                <h2 id={titleId} className={css.title}>{active?.label ?? t('empty.pages')}</h2>
              </div>
              <div className={css.headerActions}>
                {renderSlot('fabric.toolbar.action', {
                  ...owner,
                  activePage: snapshot.activePage,
                })}
                <button type="button" className={css.iconButton} aria-label={t('close')} onClick={closeFabric}>
                  <IconCloseOutline16 size={16} />
                </button>
              </div>
            </header>

            <div className={css.body}>
              <nav className={css.nav} aria-label={t('navigation')}>
                {snapshot.pages.map(page => (
                  <button
                    key={page.id}
                    type="button"
                    className={css.navItem}
                    data-active={page.id === snapshot.activePage || undefined}
                    aria-current={page.id === snapshot.activePage ? 'page' : undefined}
                    onClick={() => { openFabric(page.id) }}
                  >
                    {page.label}
                  </button>
                ))}
              </nav>
              <main className={css.content}>
                {snapshot.pages.length === 0 && <p className={css.empty}>{t('empty.pages')}</p>}
                {snapshot.pages
                  .filter(page => page.id === snapshot.activePage || visited.has(page.id))
                  .map(page => (
                    <section key={page.id} className={css.page} hidden={page.id !== snapshot.activePage}>
                      {renderSlot('fabric.page', owner, { only: page.id })}
                    </section>
                  ))}
              </main>
            </div>
          </div>
        </>
      )}

      <div className={css.extensionLayer}>
        {renderSlot('fabric.overlay', {
          ...owner,
          fabricOpen: snapshot.open,
          activePage: snapshot.activePage,
        })}
      </div>

      <div className={css.notices} aria-live="polite" aria-atomic="false">
        {snapshot.notices.map(notice => (
          <div key={notice.id} className={css.notice} data-tone={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>
            <span className={css.noticeIcon} aria-hidden><NoticeIcon tone={notice.tone} /></span>
            <span className={css.noticeText}>{notice.message}</span>
            <button
              type="button"
              className={css.noticeClose}
              aria-label={t('notice.dismiss')}
              onClick={() => { dismissNotice(notice.id) }}
            >
              <IconCloseOutline16 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
