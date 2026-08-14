import { BoundConfigForm, Section, useObservable } from '../../ui/index.tsx'
import type { FabricSettingsProps } from './props.ts'
import css from './Settings.module.css'

/** Fabric-owned settings host; schema configs render first, then plugin sections. */
export function FabricSettings({ renderSlot, openFabric, notify, t, catalog }: FabricSettingsProps) {
  const snapshot = useObservable(catalog)
  const hasConfigs = snapshot.configs.length > 0

  return (
    <div className={css.root}>
      {snapshot.configs.map(config => {
        const store = catalog.getStore(config.id)
        if (store === undefined) return null
        return (
          <Section
            key={config.id}
            title={config.title}
            {...(config.description !== undefined ? { description: config.description } : {})}
          >
            <BoundConfigForm store={store} />
          </Section>
        )
      })}
      {renderSlot('fabric.settings', { openFabric, notify }, {
        fallback: hasConfigs ? null : <p className={css.empty}>{t('empty.settings')}</p>,
      })}
    </div>
  )
}
