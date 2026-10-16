import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { z } from 'zod'
import type { Logger } from './logger'

const WRITE_DELAY_MS = 300

/**
 * Schema-validated JSON document on disk. Reads are synchronous (startup only),
 * writes are debounced and atomic (temporary file + rename) so a crash never
 * leaves a truncated document behind. A document that fails validation is
 * moved aside and replaced by the fallback instead of crashing the app.
 */
export class JsonStore<Schema extends z.ZodType> {
  private pending: z.output<Schema> | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly file: string,
    private readonly schema: Schema,
    private readonly fallback: () => z.output<Schema>,
    private readonly logger: Logger
  ) {}

  load(): z.output<Schema> {
    if (!existsSync(this.file)) return this.fallback()
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      const parsed = this.schema.safeParse(raw)
      if (parsed.success) return parsed.data
      this.logger.warn(`Invalid document ${this.file}, restoring defaults`, parsed.error.issues.slice(0, 5))
    } catch (error) {
      this.logger.warn(`Unreadable document ${this.file}, restoring defaults`, error)
    }
    this.quarantine()
    return this.fallback()
  }

  save(value: z.output<Schema>): void {
    this.pending = value
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.pending === null) return
    const value = this.pending
    this.pending = null
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.tmp`
      writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      renameSync(temporary, this.file)
    } catch (error) {
      this.logger.error(`Failed to write ${this.file}`, error)
    }
  }

  private quarantine(): void {
    try {
      renameSync(this.file, `${this.file}.invalid-${Date.now()}`)
    } catch {
      // The fallback is used regardless; the next save overwrites the file.
    }
  }
}
