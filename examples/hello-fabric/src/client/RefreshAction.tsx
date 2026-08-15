import { ToolbarButton } from '@dsh-do/fabric/ui'
import type { FabricPageActionProps } from '@dsh-do/fabric/client'

export function RefreshAction({ notify, pageId }: FabricPageActionProps) {
  return (
    <ToolbarButton
      label="Refresh example page"
      icon="↻"
      onClick={() => { notify(`Refreshed ${pageId ?? 'page'}`, { tone: 'info' }) }}
    />
  )
}
