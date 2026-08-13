import type { FabricSettingsProps } from './props.ts'
import css from './Settings.module.css'

/** Fabric-owned settings host; feature plugins contribute independent sections. */
export function FabricSettings({ renderSlot, openFabric, notify, t }: FabricSettingsProps) {
  return (
    <div className={css.root}>
      {renderSlot('fabric.settings', { openFabric, notify }, {
        fallback: <p className={css.empty}>{t('empty.settings')}</p>,
      })}
    </div>
  )
}
