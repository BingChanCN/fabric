import { describe, expect, it } from 'vitest'
import {
  assertRuntimeBundlePurity, runtimeModuleId, validateFabricRuntimePackageManifest,
} from '../src/runtime/manifest.ts'

const packageJson = {
  name: '@example/weather',
  version: '1.2.0',
  fabric: {
    format: 1,
    api: '^0.8.0',
    host: './lib/fabric-host.js',
    client: './lib/fabric-client.js',
  },
}

describe('Fabric Runtime Package manifest', () => {
  it('validates identity, API range and entries without executing code', () => {
    expect(validateFabricRuntimePackageManifest(packageJson, {
      expectedName: '@example/weather',
      expectedVersion: '1.2.0',
      fabricApiVersion: '0.8.4',
    })).toEqual(packageJson)
    expect(runtimeModuleId('@example/weather')).toBe('fabric-runtime/%40example%2Fweather')
  })

  it('rejects legacy DSH metadata, bad paths and unsupported lifecycle scripts', () => {
    expect(() => validateFabricRuntimePackageManifest({ ...packageJson, dsh: {} })).toThrow(/legacy DSH/)
    expect(() => validateFabricRuntimePackageManifest({
      ...packageJson,
      fabric: { ...packageJson.fabric, host: '../escape.js' },
    })).toThrow(/relative POSIX/)
    expect(() => validateFabricRuntimePackageManifest({
      ...packageJson,
      scripts: { install: 'node install.js' },
    })).toThrow(/lifecycle script/)
  })

  it('rejects API mismatches and malformed package shape', () => {
    expect(() => validateFabricRuntimePackageManifest(packageJson, { fabricApiVersion: '0.7.9' })).toThrow(/requires Fabric API/)
    expect(() => validateFabricRuntimePackageManifest({
      ...packageJson,
      fabric: { format: 1, api: '^0.8.0' },
    })).toThrow(/must provide/)
    expect(() => validateFabricRuntimePackageManifest({
      ...packageJson,
      fabric: { ...packageJson.fabric, format: 2 },
    })).toThrow(/unsupported Fabric format/)
  })

  it('checks final bundle externals and the exact ModuleLoader identity', () => {
    expect(() => assertRuntimeBundlePurity('client', 'require("@deepseek-ai/private")')).toThrow(/private DSH/)
    expect(() => assertRuntimeBundlePurity('client', 'require("@dsh-do/fabric-theme-studio")')).toThrow(/unsupported external/)
    expect(() => assertRuntimeBundlePurity('host', 'import value from "@dsh-do/fabric"')).toThrow(/unsupported external/)
    expect(() => assertRuntimeBundlePurity(
      'client',
      'window.__ModuleLoader__.load({ id: "fabric-runtime/%40example%2Fweather" }); require("@dsh-do/fabric")',
      { moduleId: 'fabric-runtime/%40example%2Fweather' },
    )).not.toThrow()
    expect(() => assertRuntimeBundlePurity(
      'client',
      'window.__ModuleLoader__.load({ id: "other" })',
      { moduleId: 'fabric-runtime/%40example%2Fweather' },
    )).toThrow(/expected module/)
  })
})
