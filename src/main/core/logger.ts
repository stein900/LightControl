import { createWriteStream, mkdirSync, readdirSync, rmSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const RETAINED_FILES = 7

export interface Logger {
  debug(message: string, detail?: unknown): void
  info(message: string, detail?: unknown): void
  warn(message: string, detail?: unknown): void
  error(message: string, detail?: unknown): void
  child(scope: string): Logger
}

function formatDetail(detail: unknown): string {
  if (detail === undefined) return ''
  if (detail instanceof Error) return ` ${detail.stack ?? detail.message}`
  try {
    return ` ${JSON.stringify(detail)}`
  } catch {
    return ` ${String(detail)}`
  }
}

/** Line-oriented logger writing one file per day and keeping the last week. */
export class FileLogger {
  private stream: WriteStream | null = null

  constructor(
    readonly directory: string,
    private readonly minimumLevel: LogLevel = 'info',
    private readonly mirrorToConsole = false
  ) {}

  open(): void {
    mkdirSync(this.directory, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    this.stream = createWriteStream(join(this.directory, `lightcontrol-${day}.log`), { flags: 'a' })
    this.prune()
  }

  close(): void {
    this.stream?.end()
    this.stream = null
  }

  scope(scope: string): Logger {
    const write = (level: LogLevel, message: string, detail?: unknown): void => {
      if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minimumLevel]) return
      const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${formatDetail(detail)}`
      this.stream?.write(`${line}\n`)
      if (this.mirrorToConsole) {
        if (level === 'error') console.error(line)
        else if (level === 'warn') console.warn(line)
        else process.stdout.write(`${line}\n`)
      }
    }
    return {
      debug: (message, detail) => write('debug', message, detail),
      info: (message, detail) => write('info', message, detail),
      warn: (message, detail) => write('warn', message, detail),
      error: (message, detail) => write('error', message, detail),
      child: (child) => this.scope(`${scope}:${child}`)
    }
  }

  private prune(): void {
    try {
      const files = readdirSync(this.directory)
        .filter((name) => /^lightcontrol-\d{4}-\d{2}-\d{2}\.log$/.test(name))
        .sort()
      for (const name of files.slice(0, Math.max(0, files.length - RETAINED_FILES))) {
        rmSync(join(this.directory, name), { force: true })
      }
    } catch {
      // Pruning is best effort; a locked file is retried on the next start.
    }
  }
}

/** Logger that discards everything, used by tests and as a safe default. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger
}
