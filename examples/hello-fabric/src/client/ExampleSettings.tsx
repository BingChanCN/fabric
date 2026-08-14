import { useState } from 'react'
import { createJsonClient } from 'fabric/sdk'
import type { FabricSettingsProps } from 'fabric/client'
import css from './example.module.css'

export function ExampleSettings({ notify }: FabricSettingsProps) {
  const [saved, setSaved] = useState(false)

  const save = async (): Promise<void> => {
    const client = createJsonClient({ sessionId: () => undefined })
    await client.post('/fabric-example/settings', { enabled: true }, { session: false })
    setSaved(true)
    notify('Example setting saved', { tone: 'success' })
  }

  return (
    <section className={css.settings}>
      <div>
        <strong>Example plugin</strong>
        <p>Settings contributions render inside Fabric's Plugins tab.</p>
      </div>
      <button type="button" className={css.button} onClick={() => { void save() }}>
        {saved ? 'Saved' : 'Save setting'}
      </button>
    </section>
  )
}
