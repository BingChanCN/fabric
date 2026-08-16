export function runtimePluginId(packageName: string): string {
  const id = packageName.trim()
  if (id === '' || id.endsWith('/')) throw new Error(`fabric: package name "${packageName}" has no runtime id`)
  return id
}
