import { useState } from 'react'
import { settingsResource } from '../resources.ts'
import type { FabricSettingsProps } from '@dsh-do/fabric/client'
import css from './example.module.css'

export function ExampleSettings({ resources, notify }: FabricSettingsProps) {
  const [saved, setSaved] = useState(false)

  const save = async (): Promise<void> => {
    await resources.mutate(settingsResource, { enabled: true })
    setSaved(true)
    notify('Example setting saved', { tone: 'success' })
  }

  return (
    <section className={css.settings}>
      <div>
        <strong>Example plugin</strong>
        <p>Config-attached settings render inside Fabric's Plugins tab.</p>
      </div>
      <button type="button" className={css.button} onClick={() => { void save() }}>
        {saved ? 'Saved' : 'Save setting'}
      </button>
    </section>
  )
}
