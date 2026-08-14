import { useEffect, useMemo, useRef, useState } from 'react'
import { formatShortcut } from '../shortcut.ts'
import { useObservable } from '../../ui/index.tsx'
import type { FabricCommandService } from '../commands.ts'
import css from './CommandPalette.module.css'

export function CommandPalette({
  commands,
  placeholder,
  empty,
}: {
  commands: FabricCommandService
  placeholder: string
  empty: string
}) {
  const snapshot = useObservable(commands)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement | null>(null)

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return snapshot.commands
    return snapshot.commands.filter(command => {
      return command.title.toLowerCase().includes(needle)
        || command.id.toLowerCase().includes(needle)
        || (command.description?.toLowerCase().includes(needle) ?? false)
    })
  }, [query, snapshot.commands])

  useEffect(() => {
    if (!snapshot.paletteOpen) {
      setQuery('')
      setActive(0)
      return
    }
    input.current?.focus()
  }, [snapshot.paletteOpen])

  useEffect(() => {
    setActive(0)
  }, [query])

  if (!snapshot.paletteOpen) return null

  const run = (id: string): void => {
    commands.closePalette()
    commands.execute(id)
  }

  return (
    <div className={css.root}>
      <button type="button" className={css.mask} aria-label="Close" onClick={() => { commands.closePalette() }} />
      <div
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={placeholder}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            commands.closePalette()
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive(index => Math.min(index + 1, Math.max(matches.length - 1, 0)))
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive(index => Math.max(index - 1, 0))
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            const selected = matches[active]
            if (selected !== undefined) run(selected.id)
          }
        }}
      >
        <input
          ref={input}
          className={css.input}
          value={query}
          placeholder={placeholder}
          onChange={event => { setQuery(event.target.value) }}
        />
        <ul className={css.list} role="listbox">
          {matches.length === 0 && <li className={css.empty}>{empty}</li>}
          {matches.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                className={css.item}
                data-active={index === active || undefined}
                onMouseEnter={() => { setActive(index) }}
                onClick={() => { run(command.id) }}
              >
                <span className={css.title}>{command.title}</span>
                {command.shortcut !== undefined && (
                  <kbd className={css.shortcut}>{formatShortcut(command.shortcut)}</kbd>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
