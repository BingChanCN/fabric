import { existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type * as TypeScript from 'typescript'
import { validateFabricRuntimePackageManifest } from '../runtime/manifest.ts'

const FABRIC_API_RANGE = '^1.0.0'
const CLIENT_ENTRIES = ['src/client/index.tsx', 'src/client/index.ts', 'client/index.tsx', 'client/index.ts'] as const
const HOST_ENTRIES = ['src/index.ts', 'src/index.tsx', 'src/index.mts', 'src/index.cts', 'src/index.js', 'src/index.jsx', 'src/index.mjs', 'src/index.cjs', 'index.ts', 'index.tsx', 'index.mts', 'index.cts', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs'] as const
const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const

type Ts = typeof TypeScript

export type FabricMigrationStatus = 'portable' | 'manual' | 'blocked'
export type FabricMigrationDiagnosticLevel = Exclude<FabricMigrationStatus, 'portable'>

export interface FabricMigrationDiagnostic {
  readonly level: FabricMigrationDiagnosticLevel
  readonly code: string
  readonly message: string
  readonly path: string
  readonly line: number
  readonly column: number
}

interface LegacyManifest {
  readonly name: string
  readonly version: string
  readonly description?: string
  readonly license?: string
  readonly main?: string
  readonly dependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly dsh: Readonly<Record<string, unknown>>
}

interface ComponentImport {
  readonly localName: string
  readonly importedName: string
  readonly source: string
}

interface LegacyOverlay {
  readonly id: string
  readonly order?: number
  readonly component: ComponentImport
  readonly componentFile: string
}

interface SourceModule {
  readonly file: string
  readonly source: TypeScript.SourceFile
}

interface ClientGraph {
  readonly files: readonly SourceModule[]
  readonly externalPackages: readonly string[]
}

export interface FabricMigrationAnalysis {
  readonly source: string
  readonly packageName: string
  readonly version: string
  readonly status: FabricMigrationStatus
  readonly diagnostics: readonly FabricMigrationDiagnostic[]
  readonly clientEntry?: string
  readonly overlay?: {
    readonly id: string
    readonly order?: number
    readonly component: string
  }
}

export interface FabricMigrationApplyResult {
  readonly directory: string
  readonly packageName: string
  readonly version: string
  readonly copiedFiles: readonly string[]
}

export interface FabricMigrationAnalysisOptions {
  /** Local source analysis may use the author's installed TypeScript; remote intake must not. */
  readonly useSourceTypeScript?: boolean
}

function loadTypeScript(sourceDirectory: string, useSourceTypeScript: boolean): Ts {
  if (useSourceTypeScript) {
    const sourceRequire = createRequire(join(sourceDirectory, 'package.json'))
    try {
      return sourceRequire('typescript') as Ts
    } catch {
      // Fall through to Fabric's known parser when the author project has no TypeScript install.
    }
  }
  return createRequire(import.meta.url)('typescript') as Ts
}

function loadYaml(source: string): unknown {
  const yaml = createRequire(import.meta.url)('js-yaml') as { load(value: string): unknown }
  return yaml.load(source)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function strings(value: unknown): Readonly<Record<string, string>> {
  const source = record(value)
  if (source === undefined) return Object.freeze({})
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(source)) {
    if (typeof item === 'string') result[key] = item
  }
  return Object.freeze(result)
}

function addDiagnostic(
  diagnostics: FabricMigrationDiagnostic[],
  level: FabricMigrationDiagnosticLevel,
  code: string,
  message: string,
  path: string,
  location: { line: number; column: number } = { line: 1, column: 1 },
): void {
  diagnostics.push(Object.freeze({ level, code, message, path, ...location }))
}

function location(source: TypeScript.SourceFile, node: TypeScript.Node): { line: number; column: number } {
  const value = source.getLineAndCharacterOfPosition(node.getStart(source))
  return { line: value.line + 1, column: value.character + 1 }
}

function textLocation(source: string, needle: string): { line: number; column: number } {
  const index = source.indexOf(needle)
  if (index < 0) return { line: 1, column: 1 }
  const before = source.slice(0, index)
  const lastBreak = before.lastIndexOf('\n')
  return { line: before.split('\n').length, column: index - lastBreak }
}

function sourceRelative(root: string, file: string): string | undefined {
  const value = relative(root, file)
  if (value === '' || value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value)) return undefined
  return value.split(sep).join('/')
}

function importPath(from: string, to: string): string {
  let value = relative(dirname(from), to).split(sep).join('/')
  if (value.endsWith('.ts')) value = value.slice(0, -3)
  if (value.endsWith('.tsx')) value = value.slice(0, -4)
  return value.startsWith('.') ? value : `./${value}`
}

function status(diagnostics: readonly FabricMigrationDiagnostic[]): FabricMigrationStatus {
  if (diagnostics.some(item => item.level === 'blocked')) return 'blocked'
  return diagnostics.some(item => item.level === 'manual') ? 'manual' : 'portable'
}

function isPrivateDshImport(specifier: string): boolean {
  return specifier === '@deepseek-ai/cordis' || specifier.startsWith('@deepseek-ai/')
}

function packageFor(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return undefined
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return scope === undefined || name === undefined ? undefined : `${scope}/${name}`
  }
  return specifier.split('/')[0]
}

function unwrap(ts: Ts, expression: TypeScript.Expression): TypeScript.Expression {
  let current = expression
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression
  }
  return current
}

function literalString(ts: Ts, expression: TypeScript.Expression | undefined): string | undefined {
  if (expression === undefined) return undefined
  const value = unwrap(ts, expression)
  return ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : undefined
}

function literalNumber(ts: Ts, expression: TypeScript.Expression | undefined): number | undefined {
  if (expression === undefined) return undefined
  const value = unwrap(ts, expression)
  return ts.isNumericLiteral(value) ? Number(value.text) : undefined
}

async function regularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function firstFile(root: string, candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    const file = join(root, candidate)
    if (await regularFile(file)) return file
  }
  return undefined
}

function sourceCandidatesForMain(main: string): readonly string[] {
  const local = main.replaceAll('\\', '/').replace(/^\.\//u, '')
  if (local === '' || isAbsolute(main) || local.split('/').includes('..')) return []
  const source = local.startsWith('lib/') ? `src/${local.slice(4)}` : local
  const extension = extname(source)
  if (extension === '') return [source]
  const base = source.slice(0, -extension.length)
  return [source, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map(value => `${base}${value}`)]
}

async function legacyHostEntry(root: string, main: string | undefined): Promise<string | undefined> {
  const candidates = main === undefined ? HOST_ENTRIES : sourceCandidatesForMain(main)
  return firstFile(root, [...new Set(candidates)])
}

async function resolveLocalImport(file: string, specifier: string): Promise<string | undefined> {
  const raw = resolve(dirname(file), specifier)
  const extension = extname(raw)
  const candidates = [raw]
  if (extension === '') candidates.push(...SOURCE_EXTENSIONS.map(value => `${raw}${value}`))
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    candidates.push(...SOURCE_EXTENSIONS.map(value => `${raw.slice(0, -extension.length)}${value}`))
  }
  candidates.push(...SOURCE_EXTENSIONS.map(value => join(raw, `index${value}`)))
  for (const candidate of candidates) {
    if (await regularFile(candidate)) return candidate
  }
  return undefined
}

async function sourceModule(ts: Ts, file: string): Promise<SourceModule> {
  const text = await readFile(file, 'utf8')
  return Object.freeze({
    file,
    source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
  })
}

function imports(ts: Ts, source: TypeScript.SourceFile): readonly { specifier: string; node: TypeScript.Node }[] {
  const result: { specifier: string; node: TypeScript.Node }[] = []
  const visit = (node: TypeScript.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      result.push({ specifier: node.moduleSpecifier.text, node: node.moduleSpecifier })
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
      result.push({ specifier: node.moduleSpecifier.text, node: node.moduleSpecifier })
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(source, visit)
  return result
}

function runtimeModuleLoads(ts: Ts, source: TypeScript.SourceFile): readonly TypeScript.CallExpression[] {
  const result: TypeScript.CallExpression[] = []
  const visit = (node: TypeScript.Node): void => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      result.push(node)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(source, visit)
  return result
}

function importEqualsDeclarations(ts: Ts, source: TypeScript.SourceFile): readonly TypeScript.ImportEqualsDeclaration[] {
  const result: TypeScript.ImportEqualsDeclaration[] = []
  const visit = (node: TypeScript.Node): void => {
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) result.push(node)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(source, visit)
  return result
}

function isStyleFile(path: string): boolean {
  return path.endsWith('.module.css')
}

function isUnsupportedStyleFile(path: string): boolean {
  return ['.css', '.scss', '.sass', '.less'].includes(extname(path))
}

function isSourceFile(path: string): boolean {
  return !path.endsWith('.d.ts') && SOURCE_EXTENSIONS.includes(extname(path) as typeof SOURCE_EXTENSIONS[number])
}

async function analyzeStyleFile(sourceRoot: string, style: string, diagnostics: FabricMigrationDiagnostic[]): Promise<void> {
  const text = await readFile(style, 'utf8')
  if (/\b@import\b/u.test(text)) {
    addDiagnostic(diagnostics, 'manual', 'client-style-import-unsupported', 'CSS @import needs manual migration because Runtime CSS is inlined', style, textLocation(text, '@import'))
  }
  const match = /\burl\(\s*(?:"[^"]*"|'[^']*'|[^)\s]+)\s*\)/gu.exec(text)
  if (match !== null) {
    addDiagnostic(diagnostics, 'manual', 'client-style-asset-unsupported', 'CSS url() needs manual Blob or asset migration because Runtime CSS is inlined', style, textLocation(text, match[0]))
  }
  const composition = /\bcomposes\s*:\s*[^;]*\bfrom\b/gu.exec(text)
  if (composition !== null) {
    addDiagnostic(diagnostics, 'manual', 'client-style-composes-unsupported', 'CSS Modules composes-from needs manual migration because its stylesheet dependency is not copied', style, textLocation(text, composition[0]))
  }
  if (sourceRelative(sourceRoot, style) === undefined) {
    addDiagnostic(diagnostics, 'blocked', 'client-style-escapes-source', 'Client stylesheet escapes the source directory', style)
  }
}

async function collectGraph(
  ts: Ts,
  sourceRoot: string,
  initial: string,
  diagnostics: FabricMigrationDiagnostic[],
): Promise<ClientGraph> {
  const queue = [initial]
  const seen = new Map<string, SourceModule>()
  const externalPackages = new Set<string>()
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    const module = await sourceModule(ts, file)
    seen.set(file, module)
    for (const load of runtimeModuleLoads(ts, module.source)) {
      addDiagnostic(diagnostics, 'manual', 'client-runtime-module-load-unsupported', 'Dynamic import() and require() need manual migration to a static Runtime bundle', file, location(module.source, load))
    }
    for (const declaration of importEqualsDeclarations(ts, module.source)) {
      addDiagnostic(diagnostics, 'manual', 'client-import-equals-unsupported', 'TypeScript import = require() needs manual migration to an ESM Runtime bundle', file, location(module.source, declaration))
    }
    for (const item of imports(ts, module.source)) {
      const where = location(module.source, item.node)
      if (isPrivateDshImport(item.specifier)) {
        addDiagnostic(diagnostics, 'blocked', 'client-private-dsh-import', `Client dependency imports private DSH module "${item.specifier}"`, file, where)
        continue
      }
      if (item.specifier.startsWith('node:')) {
        addDiagnostic(diagnostics, 'blocked', 'client-node-import', `Client dependency imports Node builtin "${item.specifier}"`, file, where)
        continue
      }
      if (item.specifier.startsWith('.')) {
        const target = await resolveLocalImport(file, item.specifier)
        if (target === undefined) {
          addDiagnostic(diagnostics, 'blocked', 'client-local-import-missing', `Cannot resolve local client import "${item.specifier}"`, file, where)
        } else if (sourceRelative(sourceRoot, target) === undefined) {
          addDiagnostic(diagnostics, 'blocked', 'client-local-import-escapes-source', `Client dependency "${item.specifier}" escapes the source directory`, file, where)
        } else if (isStyleFile(target)) {
          await analyzeStyleFile(sourceRoot, target, diagnostics)
        } else if (isUnsupportedStyleFile(target)) {
          addDiagnostic(diagnostics, 'manual', 'client-style-unsupported', `Client stylesheet "${item.specifier}" must be converted to a local .module.css stylesheet`, file, where)
        } else if (isSourceFile(target)) {
          queue.push(target)
        } else {
          addDiagnostic(diagnostics, 'manual', 'client-local-asset-unsupported', `Client dependency "${item.specifier}" is not source code or a stylesheet`, file, where)
        }
        continue
      }
      const packageName = packageFor(item.specifier)
      if (packageName === undefined) {
        addDiagnostic(diagnostics, 'manual', 'client-unsupported-import', `Client dependency "${item.specifier}" needs manual migration`, file, where)
      } else {
        externalPackages.add(packageName)
      }
    }
  }
  return Object.freeze({ files: Object.freeze([...seen.values()]), externalPackages: Object.freeze([...externalPackages].sort()) })
}

function properties(ts: Ts, object: TypeScript.ObjectLiteralExpression): Map<string, TypeScript.Expression> | undefined {
  const values = new Map<string, TypeScript.Expression>()
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined
    const name = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : undefined
    if (name === undefined || values.has(name)) return undefined
    values.set(name, property.initializer)
  }
  return values
}

function slotsCall(ts: Ts, expression: TypeScript.Expression, context: string, method: string): boolean {
  const value = unwrap(ts, expression)
  return ts.isPropertyAccessExpression(value)
    && value.name.text === method
    && ts.isPropertyAccessExpression(value.expression)
    && value.expression.name.text === 'slots'
    && ts.isIdentifier(value.expression.expression)
    && value.expression.expression.text === context
}

function isNamedExport(ts: Ts, statement: TypeScript.FunctionDeclaration | TypeScript.VariableStatement): boolean {
  const modifiers = ts.getModifiers(statement) ?? []
  return modifiers.some(item => item.kind === ts.SyntaxKind.ExportKeyword)
    && !modifiers.some(item => item.kind === ts.SyntaxKind.DefaultKeyword)
}

function namedFunction(ts: Ts, source: TypeScript.SourceFile, name: string): TypeScript.FunctionLikeDeclarationBase | undefined {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name && isNamedExport(ts, statement)) return statement
    if (!ts.isVariableStatement(statement) || !isNamedExport(ts, statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || declaration.initializer === undefined) continue
      const value = unwrap(ts, declaration.initializer)
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value
    }
  }
  return undefined
}

function callbackRegister(ts: Ts, expression: TypeScript.Expression | undefined): TypeScript.CallExpression | undefined {
  if (expression === undefined) return undefined
  const callback = unwrap(ts, expression)
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return undefined
  if (!ts.isBlock(callback.body)) {
    const result = unwrap(ts, callback.body)
    return ts.isCallExpression(result) ? result : undefined
  }
  if (callback.body.statements.length !== 1) return undefined
  const statement = callback.body.statements[0]
  if (statement === undefined || !ts.isReturnStatement(statement) || statement.expression === undefined) return undefined
  const result = unwrap(ts, statement.expression)
  return ts.isCallExpression(result) ? result : undefined
}

function localNamedImport(ts: Ts, source: TypeScript.SourceFile, localName: string): ComponentImport | undefined {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier) || statement.importClause === undefined) continue
    if (!statement.moduleSpecifier.text.startsWith('.')) continue
    const bindings = statement.importClause.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    for (const binding of bindings.elements) {
      if (binding.name.text === localName) {
        return Object.freeze({ localName, importedName: binding.propertyName?.text ?? localName, source: statement.moduleSpecifier.text })
      }
    }
  }
  return undefined
}

function zeroPropComponent(ts: Ts, source: TypeScript.SourceFile, name: string): boolean {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement.parameters.length === 0
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || declaration.initializer === undefined) continue
      const value = unwrap(ts, declaration.initializer)
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value.parameters.length === 0
    }
  }
  return false
}

function overlayComponentImport(ts: Ts, statement: TypeScript.ImportDeclaration, component: string): boolean {
  const clause = statement.importClause
  const bindings = clause?.namedBindings
  return clause?.isTypeOnly !== true
    && clause?.name === undefined
    && bindings !== undefined
    && ts.isNamedImports(bindings)
    && bindings.elements.length === 1
    && bindings.elements[0]?.name.text === component
}

function simpleClientEntry(ts: Ts, source: TypeScript.SourceFile, component: string): boolean {
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (typeOnlyImport(ts, statement) || overlayComponentImport(ts, statement, component)) continue
      return false
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'apply') continue
    if (ts.isVariableStatement(statement)) {
      const declarations = [...statement.declarationList.declarations]
      if (declarations.length === 1 && ts.isIdentifier(declarations[0]!.name) && declarations[0]!.name.text === 'apply') continue
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier === undefined) continue
    return false
  }
  return true
}

async function analyzeOverlay(
  ts: Ts,
  sourceRoot: string,
  entry: SourceModule,
  diagnostics: FabricMigrationDiagnostic[],
): Promise<LegacyOverlay | undefined> {
  const apply = namedFunction(ts, entry.source, 'apply')
  if (apply === undefined || apply.body === undefined || !ts.isBlock(apply.body) || apply.parameters.length !== 1 || !ts.isIdentifier(apply.parameters[0]!.name)) {
    addDiagnostic(diagnostics, 'manual', 'client-apply-unsupported', 'Client entry must export apply(ctx) for automatic migration', entry.file)
    return undefined
  }
  const context = apply.parameters[0]!.name.text
  if (apply.body.statements.length !== 1 || !ts.isExpressionStatement(apply.body.statements[0]!)) {
    addDiagnostic(diagnostics, 'manual', 'client-apply-extra-behavior', 'Client apply() contains behavior that cannot be mapped without changing semantics', entry.file, location(entry.source, apply))
    return undefined
  }
  const injection = unwrap(ts, apply.body.statements[0]!.expression)
  if (!ts.isCallExpression(injection) || !slotsCall(ts, injection.expression, context, 'inject') || literalString(ts, injection.arguments[0]) !== 'shell.overlay') {
    addDiagnostic(diagnostics, 'manual', 'client-slot-unsupported', 'Automatic migration only supports one shell.overlay registration', entry.file, location(entry.source, injection))
    return undefined
  }
  const registration = callbackRegister(ts, injection.arguments[1])
  if (registration === undefined || !slotsCall(ts, registration.expression, context, 'register')) {
    addDiagnostic(diagnostics, 'manual', 'client-overlay-callback-unsupported', 'shell.overlay must return ctx.slots.register(...) directly', entry.file, location(entry.source, injection))
    return undefined
  }
  const config = registration.arguments[0]
  const component = registration.arguments[1]
  if (config === undefined || !ts.isObjectLiteralExpression(config) || component === undefined || !ts.isIdentifier(component)) {
    addDiagnostic(diagnostics, 'manual', 'client-overlay-registration-unsupported', 'shell.overlay registration must use a literal config and local component import', entry.file, location(entry.source, registration))
    return undefined
  }
  const values = properties(ts, config)
  if (values === undefined || [...values.keys()].some(name => !['name', 'id', 'order'].includes(name))) {
    addDiagnostic(diagnostics, 'manual', 'client-overlay-props-unsupported', 'shell.overlay registration uses injected props, locale, children, or another unsupported field', entry.file, location(entry.source, config))
    return undefined
  }
  const id = literalString(ts, values.get('id'))
  const order = values.has('order') ? literalNumber(ts, values.get('order')) : undefined
  if (literalString(ts, values.get('name')) !== 'shell.overlay' || id === undefined || id.trim() === '' || (values.has('order') && order === undefined)) {
    addDiagnostic(diagnostics, 'manual', 'client-overlay-config-unsupported', 'shell.overlay requires literal name, non-empty id, and optional numeric order', entry.file, location(entry.source, config))
    return undefined
  }
  const imported = localNamedImport(ts, entry.source, component.text)
  if (imported === undefined) {
    addDiagnostic(diagnostics, 'manual', 'client-overlay-component-unsupported', 'shell.overlay component must be a named local import', entry.file, location(entry.source, component))
    return undefined
  }
  if (!simpleClientEntry(ts, entry.source, component.text)) {
    addDiagnostic(diagnostics, 'manual', 'client-entry-top-level-unsupported', 'Client entry has top-level behavior or imports that would be dropped by a Runtime migration', entry.file)
    return undefined
  }
  const componentFile = await resolveLocalImport(entry.file, imported.source)
  if (componentFile === undefined || sourceRelative(sourceRoot, componentFile) === undefined) {
    addDiagnostic(diagnostics, 'blocked', 'client-overlay-component-missing', `Cannot resolve overlay component "${imported.source}"`, entry.file, location(entry.source, component))
    return undefined
  }
  if (!isSourceFile(componentFile)) {
    addDiagnostic(diagnostics, 'manual', 'client-overlay-component-language-unsupported', 'Overlay component must be a .ts or .tsx source file', componentFile)
    return undefined
  }
  const componentSource = await sourceModule(ts, componentFile)
  if (!zeroPropComponent(ts, componentSource.source, imported.importedName)) {
    addDiagnostic(diagnostics, 'manual', 'client-overlay-component-props', 'Overlay component must export a zero-prop function; Fabric HUD supplies a different prop contract', componentFile, location(componentSource.source, componentSource.source))
    return undefined
  }
  return Object.freeze({ id, ...(order === undefined ? {} : { order }), component: imported, componentFile })
}

function inertHostParameters(ts: Ts, parameters: readonly TypeScript.ParameterDeclaration[]): boolean {
  return parameters.every(parameter => ts.isIdentifier(parameter.name) && parameter.initializer === undefined && parameter.dotDotDotToken === undefined)
}

function emptyHostCallback(ts: Ts, value: TypeScript.Expression | undefined): boolean {
  if (value === undefined) return false
  const callback = unwrap(ts, value)
  return (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
    && inertHostParameters(ts, callback.parameters)
    && ts.isBlock(callback.body)
    && callback.body.statements.length === 0
}

function literalHostValue(ts: Ts, name: string, value: TypeScript.Expression | undefined): boolean {
  if (value === undefined) return false
  const initial = unwrap(ts, value)
  if (name === 'name') return ts.isStringLiteralLike(initial)
  return name === 'inject' && ts.isArrayLiteralExpression(initial) && initial.elements.every(item => ts.isStringLiteralLike(item))
}

function typeOnlyImport(ts: Ts, statement: TypeScript.ImportDeclaration): boolean {
  if (statement.importClause?.isTypeOnly === true) return true
  const bindings = statement.importClause?.namedBindings
  return bindings !== undefined
    && ts.isNamedImports(bindings)
    && bindings.elements.length > 0
    && bindings.elements.every(item => item.isTypeOnly)
}

function emptyHost(ts: Ts, source: TypeScript.SourceFile): boolean {
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (typeOnlyImport(ts, statement)) continue
      return false
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'apply') {
      if (inertHostParameters(ts, statement.parameters) && (statement.body === undefined || statement.body.statements.length === 0)) continue
      return false
    }
    if (ts.isVariableStatement(statement)) {
      const allowed = [...statement.declarationList.declarations].every(item => ts.isIdentifier(item.name) && (
        (['name', 'inject'].includes(item.name.text) && literalHostValue(ts, item.name.text, item.initializer))
        || (item.name.text === 'apply' && emptyHostCallback(ts, item.initializer))
      ))
      if (allowed) continue
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier === undefined) continue
    return false
  }
  return true
}

async function parseManifest(source: string): Promise<LegacyManifest> {
  const path = join(source, 'package.json')
  const value = record(JSON.parse(await readFile(path, 'utf8')) as unknown)
  if (value === undefined) throw new Error(`${path} must contain a JSON object`)
  if (typeof value.name !== 'string' || value.name.trim() === '') throw new Error(`${path} must declare a package name`)
  if (typeof value.version !== 'string' || value.version.trim() === '') throw new Error(`${path} must declare a version`)
  const dsh = record(value.dsh)
  if (dsh === undefined) throw new Error(`${path} is not a legacy DSH plugin (missing dsh)`)
  return Object.freeze({
    name: value.name,
    version: value.version,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.license === 'string' ? { license: value.license } : {}),
    ...(typeof value.main === 'string' ? { main: value.main } : {}),
    dependencies: strings(value.dependencies),
    devDependencies: strings(value.devDependencies),
    peerDependencies: strings(value.peerDependencies),
    dsh: Object.freeze(dsh),
  })
}

async function analyzePatch(source: string, manifest: LegacyManifest, diagnostics: FabricMigrationDiagnostic[]): Promise<void> {
  const bundle = record(manifest.dsh.bundle)
  const declared = bundle?.patch
  if (typeof declared !== 'string' || declared.trim() === '') {
    addDiagnostic(diagnostics, 'blocked', 'patch-missing', 'Legacy plugin must declare dsh.bundle.patch before it can be migrated', join(source, 'package.json'))
    return
  }
  const path = resolve(source, declared)
  if (sourceRelative(source, path) === undefined || !await regularFile(path)) {
    addDiagnostic(diagnostics, 'blocked', 'patch-missing', `Cannot read declared Cordis patch "${declared}"`, join(source, 'package.json'))
    return
  }
  const text = await readFile(path, 'utf8')
  let value: unknown
  try {
    value = loadYaml(text)
  } catch (error) {
    addDiagnostic(diagnostics, 'blocked', 'patch-invalid-yaml', `Cordis patch is not valid YAML: ${error instanceof Error ? error.message : String(error)}`, path, textLocation(text, '---'))
    return
  }
  const operations = Array.isArray(value) ? value : undefined
  const operation = record(operations?.[0])
  const inserts = Array.isArray(operation?.insert) ? operation?.insert : undefined
  const item = record(inserts?.[0])
  if (operations?.length !== 1 || operation === undefined || Object.keys(operation).length !== 1 || inserts?.length !== 1 || item?.name !== manifest.name || typeof item.id !== 'string') {
    addDiagnostic(diagnostics, 'blocked', 'patch-profile-mutation', 'Automatic migration only accepts the standard one-entry Cordis insert patch for this package', path, textLocation(text, 'insert'))
  }
}

function dependenciesFor(manifest: LegacyManifest, packages: readonly string[], diagnostics: FabricMigrationDiagnostic[], source: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const packageName of packages) {
    if (packageName === '@dsh-do/fabric' || packageName === 'react' || packageName === 'react-dom') continue
    const version = manifest.dependencies[packageName] ?? manifest.devDependencies[packageName] ?? manifest.peerDependencies[packageName]
    if (version === undefined) {
      addDiagnostic(diagnostics, 'manual', 'client-external-dependency-undeclared', `Client dependency "${packageName}" is not declared in package.json`, join(source, 'package.json'))
    } else {
      result[packageName] = version
    }
  }
  return Object.freeze(result)
}

async function declarations(root: string, directory: string): Promise<readonly string[]> {
  const result: string[] = []
  const visit = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'lib') continue
      const target = join(path, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile() && entry.name.endsWith('.d.ts') && sourceRelative(root, target) !== undefined) result.push(target)
    }
  }
  await visit(directory)
  return Object.freeze(result)
}

export async function analyzeLegacyDshPlugin(
  directory: string,
  options: FabricMigrationAnalysisOptions = {},
): Promise<FabricMigrationAnalysis> {
  const source = resolve(directory)
  const manifest = await parseManifest(source)
  const diagnostics: FabricMigrationDiagnostic[] = []
  await analyzePatch(source, manifest, diagnostics)
  if (manifest.dsh.client === undefined) addDiagnostic(diagnostics, 'manual', 'client-missing', 'Legacy plugin has no dsh.client half; this migration only converts a simple browser overlay', join(source, 'package.json'))
  const entryPath = await firstFile(source, CLIENT_ENTRIES)
  if (entryPath === undefined) addDiagnostic(diagnostics, 'manual', 'client-entry-missing', `Cannot find a supported legacy client entry (${CLIENT_ENTRIES.join(', ')})`, source)
  const ts = loadTypeScript(source, options.useSourceTypeScript !== false)
  let overlay: LegacyOverlay | undefined
  let graph: ClientGraph | undefined
  if (entryPath !== undefined) {
    overlay = await analyzeOverlay(ts, source, await sourceModule(ts, entryPath), diagnostics)
    if (overlay !== undefined) graph = await collectGraph(ts, source, overlay.componentFile, diagnostics)
  }
  const hostPath = await legacyHostEntry(source, manifest.main)
  if (manifest.main !== undefined && hostPath === undefined) {
    addDiagnostic(diagnostics, 'manual', 'host-entry-missing', `Cannot find source for legacy Host entry ${JSON.stringify(manifest.main)}`, join(source, 'package.json'))
  } else if (hostPath !== undefined && hostPath !== entryPath) {
    if (!isSourceFile(hostPath)) {
      addDiagnostic(diagnostics, 'manual', 'host-language-unsupported', 'Legacy Host must be a .ts or .tsx source file for automatic migration', hostPath)
    } else if (!emptyHost(ts, (await sourceModule(ts, hostPath)).source)) {
      addDiagnostic(diagnostics, 'manual', 'host-behavior-unsupported', 'Legacy Host behavior requires an explicit Fabric Host API migration', hostPath)
    }
  }
  if (graph !== undefined) {
    dependenciesFor(manifest, graph.externalPackages, diagnostics, source)
    for (const declaration of await declarations(source, source)) {
      addDiagnostic(diagnostics, 'manual', 'client-declaration-unsupported', 'Legacy client declaration files need an explicit Runtime type migration', declaration)
    }
  }
  return Object.freeze({
    source,
    packageName: manifest.name,
    version: manifest.version,
    status: status(diagnostics),
    diagnostics: Object.freeze(diagnostics),
    ...(entryPath === undefined ? {} : { clientEntry: entryPath }),
    ...(overlay === undefined ? {} : { overlay: Object.freeze({ id: overlay.id, ...(overlay.order === undefined ? {} : { order: overlay.order }), component: overlay.component.localName }) }),
  })
}

export function formatFabricMigrationAnalysis(analysis: FabricMigrationAnalysis): string {
  const lines = [`${analysis.status} ${analysis.packageName}@${analysis.version}`, `source ${analysis.source}`]
  if (analysis.overlay !== undefined) lines.push(`portable mapping shell.overlay#${analysis.overlay.id} -> fabric.hud#${analysis.overlay.id}`)
  for (const item of analysis.diagnostics) lines.push(`${item.level} ${item.code} ${item.path}:${item.line}:${item.column} ${item.message}`)
  return `${lines.join('\n')}\n`
}

function assertPortable(analysis: FabricMigrationAnalysis): void {
  if (analysis.status === 'portable') return
  throw new Error(`cannot apply Fabric migration:\n${formatFabricMigrationAnalysis(analysis)}`)
}

function runtimeManifest(manifest: LegacyManifest, dependencies: Readonly<Record<string, string>>): Record<string, unknown> {
  return {
    name: manifest.name,
    version: manifest.version,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    ...(manifest.license === undefined ? {} : { license: manifest.license }),
    type: 'module',
    fabric: { format: 1, api: FABRIC_API_RANGE, client: './lib/fabric-client.js' },
    files: ['lib'],
    scripts: {
      clean: 'node -e "require(\'node:fs\').rmSync(\'lib\',{recursive:true,force:true})"',
      build: 'pnpm run clean && pnpm run typecheck && fabric build',
      typecheck: 'tsc --noEmit',
      verify: 'fabric verify',
      pack: 'fabric pack',
      prepack: 'pnpm run build && pnpm run verify',
      prepublishOnly: 'pnpm run verify',
    },
    ...(Object.keys(dependencies).length === 0 ? {} : { dependencies }),
    devDependencies: {
      '@dsh-do/fabric': FABRIC_API_RANGE,
      '@types/node': '^22.20.0',
      '@types/react': '~18.3.1',
      '@types/react-dom': '~18.3.1',
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      tsdown: '0.22.2',
      typescript: '~5.7.2',
    },
  }
}

function renderedClient(analysis: FabricMigrationAnalysis, componentPath: string, componentImport: ComponentImport): string {
  if (analysis.overlay === undefined) throw new Error('portable migration is missing overlay data')
  const order = analysis.overlay.order === undefined ? '' : `,\n      order: ${String(analysis.overlay.order)}`
  const component = componentImport.importedName === componentImport.localName
    ? componentImport.localName
    : `${componentImport.importedName} as ${componentImport.localName}`
  return [
    "import { defineClientPlugin } from '@dsh-do/fabric/client'",
    `import { ${component} } from ${JSON.stringify(componentPath)}`,
    '',
    'export default defineClientPlugin({',
    `  descriptor: { name: ${JSON.stringify(basename(analysis.packageName))} },`,
    '  setup(ctx) {',
    '    ctx.hud.define({',
    `      id: ${JSON.stringify(analysis.overlay.id)}${order},`,
    `      component: ${analysis.overlay.component},`,
    '    })',
    '  },',
    '})',
    '',
  ].join('\n')
}

async function copyFiles(
  ts: Ts,
  source: string,
  output: string,
  graph: ClientGraph,
  declarationFiles: readonly string[],
): Promise<readonly string[]> {
  const copied = new Set<string>()
  for (const file of new Set([...graph.files.map(item => item.file), ...declarationFiles])) {
    const sourcePath = sourceRelative(source, file)
    if (sourcePath === undefined) throw new Error(`migration source file escapes source directory: ${file}`)
    const destination = join(output, 'src', 'legacy', sourcePath)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(file, destination)
    copied.add(sourcePath)
    const module = await sourceModule(ts, file)
    for (const item of imports(ts, module.source)) {
      if (!item.specifier.startsWith('.')) continue
      const asset = await resolveLocalImport(file, item.specifier)
      if (asset === undefined || !isStyleFile(asset)) continue
      const assetPath = sourceRelative(source, asset)
      if (assetPath === undefined) throw new Error(`migration asset escapes source directory: ${asset}`)
      const assetDestination = join(output, 'src', 'legacy', assetPath)
      await mkdir(dirname(assetDestination), { recursive: true })
      await copyFile(asset, assetDestination)
      copied.add(assetPath)
    }
  }
  return Object.freeze([...copied].sort())
}

export async function applyLegacyDshPluginMigration(sourceDirectory: string, outputDirectory: string): Promise<FabricMigrationApplyResult> {
  const source = resolve(sourceDirectory)
  const output = resolve(outputDirectory)
  if (output === source || output.startsWith(`${source}${sep}`)) throw new Error('--out must be outside the legacy source directory')
  if (existsSync(output)) throw new Error(`migration output already exists: ${output}`)
  const analysis = await analyzeLegacyDshPlugin(source)
  assertPortable(analysis)
  if (analysis.clientEntry === undefined || analysis.overlay === undefined) throw new Error('portable migration is missing client data')
  const manifest = await parseManifest(source)
  const ts = loadTypeScript(source, true)
  const entry = await sourceModule(ts, analysis.clientEntry)
  const imported = localNamedImport(ts, entry.source, analysis.overlay.component)
  if (imported === undefined) throw new Error('portable migration component import changed during analysis')
  const componentFile = await resolveLocalImport(analysis.clientEntry, imported.source)
  if (componentFile === undefined) throw new Error('portable migration component file changed during analysis')
  const diagnostics: FabricMigrationDiagnostic[] = []
  const graph = await collectGraph(ts, source, componentFile, diagnostics)
  const dependencies = dependenciesFor(manifest, graph.externalPackages, diagnostics, source)
  if (status(diagnostics) !== 'portable') throw new Error(`migration source changed during analysis:\n${diagnostics.map(item => `${item.code}: ${item.message}`).join('\n')}`)
  const declarationFiles = await declarations(source, source)
  const clientPath = join(output, 'src', 'client', 'index.tsx')
  const mappedComponent = join(output, 'src', 'legacy', sourceRelative(source, componentFile)!)
  let createdOutput = false
  try {
    await mkdir(output, { recursive: false })
    createdOutput = true
    const generated = runtimeManifest(manifest, dependencies)
    validateFabricRuntimePackageManifest(generated, { expectedName: manifest.name, expectedVersion: manifest.version, fabricApiVersion: '1.0.0' })
    await writeFile(join(output, 'package.json'), `${JSON.stringify(generated, null, 2)}\n`, { flag: 'wx' })
    await writeFile(join(output, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: false, skipLibCheck: true, noEmit: true, types: ['node'] },
      include: ['src'],
    }, null, 2)}\n`, { flag: 'wx' })
    await writeFile(join(output, 'tsdown.config.ts'), "import { defineConfig } from 'tsdown'\nimport { fabricRuntimePackage } from '@dsh-do/fabric/build'\n\nexport default defineConfig(fabricRuntimePackage({ hostEntry: false, clientEntry: 'src/client/index.tsx' }))\n", { flag: 'wx' })
    await mkdir(dirname(clientPath), { recursive: true })
    await writeFile(clientPath, renderedClient(analysis, importPath(clientPath, mappedComponent), imported), { flag: 'wx' })
    await writeFile(join(output, 'src', 'css.d.ts'), "declare module '*.css' {\n  const classes: Record<string, string>\n  export default classes\n}\n", { flag: 'wx' })
    await writeFile(join(output, 'README.md'), `# ${manifest.name}\n\nGenerated by \`fabric migrate apply\`. The legacy \`shell.overlay\` contribution is now a Fabric HUD.\n\nRun \`pnpm install && pnpm build && fabric verify\` before publishing.\n`, { flag: 'wx' })
    const copiedFiles = await copyFiles(ts, source, output, graph, declarationFiles)
    return Object.freeze({ directory: output, packageName: manifest.name, version: manifest.version, copiedFiles })
  } catch (error) {
    if (createdOutput) await rm(output, { recursive: true, force: true })
    throw error
  }
}
