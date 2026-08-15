export function runtimePluginId(packageName: string): string {
  const id = packageName.slice(packageName.lastIndexOf('/') + 1)
  if (id === '') throw new Error(`fabric: package name "${packageName}" has no runtime id`)
  return id
}
