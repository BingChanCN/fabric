const PACKAGE_PART = /^[a-z0-9][a-z0-9._-]*$/u

export function isFabricPackageName(value: string): boolean {
  if (value.length === 0 || value.length > 214 || value === '.' || value === '..') return false
  if (value.startsWith('@')) {
    const parts = value.slice(1).split('/')
    return parts.length === 2 && parts.every(part => PACKAGE_PART.test(part) && part !== '.' && part !== '..')
  }
  return !value.includes('/') && PACKAGE_PART.test(value)
}

export function runtimeModuleId(packageName: string): string {
  return `fabric-runtime/${encodeURIComponent(packageName)}`
}
