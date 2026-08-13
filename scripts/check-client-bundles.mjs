import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

class StubService {
  constructor(ctx, name) {
    this.ctx = ctx
    this.name = name
  }
}

const externals = {
  '@deepseek-ai/cordis': { Service: StubService },
  '@deepseek-ai/dsh-client-ui-primitives': {},
  '@deepseek-ai/dsh-client-ui-slots': {
    resolveSlotLabel: value => typeof value === 'function' ? value() : value,
  },
  react: {},
  'react/jsx-runtime': {
    Fragment: Symbol('Fragment'),
    jsx: () => null,
    jsxs: () => null,
  },
}

const checks = [
  {
    file: 'lib/client.js',
    id: '@cortexkit/fabric',
    inject: ['slots', 'locale'],
    requires: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-slots',
      'react',
      'react/jsx-runtime',
    ],
  },
  {
    file: 'examples/hello-fabric/lib/client.js',
    id: '@cortexkit/fabric-example',
    inject: ['fabric'],
    requires: [
      '@deepseek-ai/dsh-client-ui-primitives',
      'react',
      'react/jsx-runtime',
    ],
  },
]

function fail(file, message) {
  throw new Error(`client bundle check: ${file}: ${message}`)
}

for (const check of checks) {
  const filename = resolve(root, check.file)
  const source = await readFile(filename, 'utf8')
  let handoff
  const context = vm.createContext({
    URL,
    clearTimeout,
    console,
    document: undefined,
    setTimeout,
    window: {
      __ModuleLoader__: {
        load(definition) {
          if (handoff !== undefined) fail(check.file, 'registered more than one ModuleLoader handoff')
          handoff = definition
        },
      },
    },
  })

  new vm.Script(source, { filename }).runInContext(context, { timeout: 5_000 })
  if (handoff === undefined) fail(check.file, 'did not register a ModuleLoader handoff')
  if (handoff.id !== check.id) fail(check.file, `registered ${JSON.stringify(handoff.id)} instead of ${JSON.stringify(check.id)}`)
  if (typeof handoff.factory !== 'function') fail(check.file, 'handoff factory is not callable')

  const required = []
  const exports = handoff.factory((id) => {
    required.push(id)
    if (!(id in externals)) fail(check.file, `requires unknown external ${JSON.stringify(id)}`)
    return externals[id]
  })
  if (exports === null || typeof exports !== 'object') fail(check.file, 'factory did not return an exports object')
  if (typeof exports.apply !== 'function') fail(check.file, 'exports.apply is not callable')

  const actualInject = Array.isArray(exports.inject) ? [...exports.inject] : []
  if (JSON.stringify(actualInject) !== JSON.stringify(check.inject)) {
    fail(check.file, `exports inject ${JSON.stringify(actualInject)} instead of ${JSON.stringify(check.inject)}`)
  }

  const actualRequires = [...new Set(required)].sort()
  const expectedRequires = [...check.requires].sort()
  if (JSON.stringify(actualRequires) !== JSON.stringify(expectedRequires)) {
    fail(check.file, `requires ${JSON.stringify(actualRequires)} instead of ${JSON.stringify(expectedRequires)}`)
  }

  console.log(`client bundle check passed: ${check.id} (inject=${JSON.stringify(actualInject)})`)
}
