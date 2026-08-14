import { defineConfig } from 'tsdown'
import { fabricClient } from './src/build/index.ts'

const PACKAGE_ID = 'fabric'
const client = fabricClient({ id: PACKAGE_ID })
const libraryPlugins = fabricClient({ id: PACKAGE_ID, entry: 'src/ui/index.tsx' }).plugins

export default defineConfig([
  {
    name: `${PACKAGE_ID}/library`,
    entry: {
      index: 'src/index.ts',
      sdk: 'src/sdk/index.ts',
      ui: 'src/ui/index.tsx',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: ['react', 'react/jsx-runtime', 'react-dom'],
      alwaysBundle: (id: string) => id === 'react' || id === 'react/jsx-runtime' || id === 'react-dom' ? false : true,
    },
    plugins: libraryPlugins,
    outputOptions: { entryFileNames: '[name].js' },
  },
  {
    name: `${PACKAGE_ID}/build`,
    entry: { build: 'src/build/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: { neverBundle: ['lightningcss'] },
    outputOptions: { entryFileNames: '[name].js' },
  },
  client,
])
