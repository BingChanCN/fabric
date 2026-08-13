import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { ToolbarButton } from '@cortexkit/fabric/ui'
import type { FabricToolbarActionProps } from '@cortexkit/fabric/client'

export function RefreshAction({ notify, activePage }: FabricToolbarActionProps) {
  return (
    <ToolbarButton
      label="Refresh example page"
      icon={<IconRefreshOutline16 size={16} />}
      onClick={() => { notify(`Refreshed ${activePage ?? 'page'}`, { tone: 'info' }) }}
    />
  )
}
