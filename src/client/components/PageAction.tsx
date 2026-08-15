import { useEffect, useRef, useState } from 'react'
import { ToolbarButton } from '../../ui/index.tsx'
import type {
  FabricDeclarativePageActionDefinition, FabricPageActionProps,
} from '../plugin.ts'

export function DeclarativePageAction({
  definition,
  context,
}: {
  definition: FabricDeclarativePageActionDefinition
  context: FabricPageActionProps
}) {
  const [pending, setPending] = useState(false)
  const running = useRef<AbortController | undefined>(undefined)

  useEffect(() => () => { running.current?.abort() }, [])

  if (definition.hidden === true) return null

  const invoke = async (): Promise<void> => {
    if (running.current !== undefined || pending || definition.disabled === true || context.signal.aborted) return
    const controller = new AbortController()
    running.current = controller
    const abort = (): void => { controller.abort() }
    context.signal.addEventListener('abort', abort, { once: true })
    if (context.signal.aborted) controller.abort()
    setPending(true)
    try {
      await definition.onClick({ ...context, signal: controller.signal })
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        context.notify(message, { tone: 'error' })
      }
    } finally {
      context.signal.removeEventListener('abort', abort)
      if (running.current === controller) running.current = undefined
      setPending(false)
    }
  }

  return (
    <ToolbarButton
      label={definition.label}
      {...(definition.tooltip === undefined ? {} : { tooltip: definition.tooltip })}
      icon={definition.icon}
      {...(definition.tone === undefined ? {} : { tone: definition.tone })}
      loading={pending}
      disabled={definition.disabled === true || context.signal.aborted}
      onClick={() => { void invoke() }}
    />
  )
}
