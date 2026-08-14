import type { Context } from '@deepseek-ai/cordis'

/**
 * Host-side Cordis entry.
 * Registers prefix route `/fabric/config` for schema-driven config documents
 * persisted under `$DSH_HOME/fabric/config`.
 */
export declare function apply(ctx: Context): void
