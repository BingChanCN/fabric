import { useEffect, useId, useRef, useState } from 'react'
import {
  IconCheckOutline16, IconCloseOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FabricNoticeTone } from '../contract.ts'
import { CommandPalette } from './CommandPalette.tsx'
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
  commands,
  t,
}: WorkbenchProps) {
  const titleId = useId()
  const snapshot = useFabric(value => value)
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set())
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false)
  const dialog = useRef<HTMLDivElement | null>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (snapshot.open && !hasOpenedOnce) {
      setHasOpenedOnce(true)
    }
  }, [snapshot.open, hasOpenedOnce])

  useEffect(() => {
    const active = snapshot.activePage
    if (active === undefined) return
    const activePageObj = snapshot.pages.find(p => p.id === active)
    if (activePageObj && activePageObj.keepAlive === false) {
      // Don't retain in visited set if keepAlive is explicitly false
      return
    }
    setVisited(previous => previous.has(active) ? previous : new Set([...previous, active]))
  }, [snapshot.activePage, snapshot.pages])

  useEffect(() => {
    setVisited(previous => {
      const live = new Set(snapshot.pages.filter(p => p.keepAlive !== false).map(page => page.id))
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

  // Drawer shell is kept mounted once opened so keepAlive pages preserve state across open/close
  const shouldRenderDrawer = snapshot.open || hasOpenedOnce

  return (
    <div className={css.host} data-open={snapshot.open || undefined}>
      {shouldRenderDrawer && (
        <>
          <button
            type="button"
            className={css.mask}
            aria-label={t('close')}
            onClick={closeFabric}
            hidden={!snapshot.open}
            style={snapshot.open ? undefined : { display: 'none' }}
          />
          <div
            ref={dialog}
            className={css.drawer}
            data-fabric-workbench="true"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-hidden={!snapshot.open}
            hidden={!snapshot.open}
            style={snapshot.open ? undefined : { display: 'none' }}
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
                    <div className={css.navContent}>
                      {page.icon && <span className={css.navIcon}>{page.icon}</span>}
                      <span className={css.navLabel}>{page.label}</span>
                      {page.badge !== undefined && (
                        <span className={css.navBadge}>{page.badge}</span>
                      )}
                    </div>
                  </button>
                ))}
              </nav>
              <main className={css.content}>
                {snapshot.pages.length === 0 && <p className={css.empty}>{t('empty.pages')}</p>}
                {snapshot.pages
                  .filter(page => page.id === snapshot.activePage || (page.keepAlive !== false && visited.has(page.id)))
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
      <CommandPalette
        commands={commands}
        placeholder={t('command.paletteHint')}
        empty={t('command.empty')}
      />
    </div>
  )
}
