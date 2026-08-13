import { IconCodeOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LauncherProps } from './props.ts'
import css from './Launcher.module.css'

/** Sidebar launcher hosted in DSH's additive footer-action slot. */
export function Launcher({ wide, openFabric, t }: LauncherProps) {
  return (
    <Tooltip label={t('launcher')} delayMs={400} disabled={wide}>
      <button type="button" className={css.button} aria-label={t('launcher')} onClick={openFabric}>
        <IconCodeOutline16 size={wide ? 16 : 18} />
        {wide && <span className={css.label}>{t('name')}</span>}
      </button>
    </Tooltip>
  )
}
