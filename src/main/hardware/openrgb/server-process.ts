import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { TypedEmitter } from '@main/core/typed-emitter'
import type { Logger } from '@main/core/logger'
import { processIdsByPath } from '@main/system/windows-system'

export interface ServerLaunchOptions {
  executable: string
  configDirectory: string
  host: string
  port: number
  /** Launch through UAC so OpenRGB can reach SMBus devices (memory) via PawnIO. */
  elevated: boolean
}

export interface ServerProcessEvents {
  exited: [code: number | null]
}

/** Locations searched for OpenRGB.exe, in priority order. */
export function executableCandidates(options: {
  customPath: string | null
  isPackaged: boolean
  resourcesPath: string
  appPath: string
}): string[] {
  const candidates: string[] = []
  if (options.customPath) candidates.push(options.customPath)
  candidates.push(
    options.isPackaged
      ? join(options.resourcesPath, 'openrgb', 'OpenRGB.exe')
      : join(options.appPath, 'vendor', 'openrgb', 'OpenRGB.exe')
  )
  const programFiles = process.env['ProgramFiles']
  if (programFiles) candidates.push(join(programFiles, 'OpenRGB', 'OpenRGB.exe'))
  return candidates
}

export function resolveExecutable(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function serverArguments(options: ServerLaunchOptions): string[] {
  return [
    '--server',
    '--server-host',
    options.host,
    '--server-port',
    String(options.port),
    '--noautoconnect',
    '--config',
    options.configDirectory
  ]
}

/** Quotes a value for a single-quoted PowerShell string literal. */
function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Owns the OpenRGB process started by LightControl. A non-elevated server is a
 * child process and is stopped with the app. An elevated server is started via
 * UAC, is not a child, and keeps running so the next launch can reuse it.
 */
export class OpenRgbServerProcess {
  readonly events = new TypedEmitter<ServerProcessEvents>()
  private child: ChildProcess | null = null

  constructor(private readonly logger: Logger) {}

  get owned(): boolean {
    return this.child !== null && this.child.exitCode === null
  }

  async launch(options: ServerLaunchOptions): Promise<void> {
    mkdirSync(options.configDirectory, { recursive: true })
    const args = serverArguments(options)

    if (options.elevated) {
      await this.launchElevated(options.executable, args)
      return
    }

    this.logger.info(`Starting OpenRGB server on ${options.host}:${options.port}`)
    const child = spawn(options.executable, args, {
      cwd: dirname(options.executable),
      windowsHide: true,
      stdio: 'ignore'
    })
    child.once('error', (error) => this.logger.error('OpenRGB process error', error))
    child.once('exit', (code) => {
      this.logger.warn(`OpenRGB process exited with code ${code}`)
      if (this.child === child) this.child = null
      this.events.emit('exited', code)
    })
    this.child = child
  }

  stop(): void {
    if (!this.child) return
    this.logger.info('Stopping OpenRGB server')
    this.child.kill()
    this.child = null
  }

  /**
   * Terminates instances of `executable` that outlived a previous LightControl
   * session (for example after a crash, since Windows does not stop children
   * with their parent). Elevated instances cannot be stopped and are skipped.
   */
  async stopStrays(executable: string): Promise<void> {
    for (const pid of await processIdsByPath(executable)) {
      try {
        process.kill(pid)
        this.logger.info(`Stopped leftover OpenRGB process ${pid}`)
      } catch {
        // Access denied (elevated instance) or already gone.
      }
    }
  }

  private launchElevated(executable: string, args: string[]): Promise<void> {
    const argumentList = args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ')
    const command = [
      'Start-Process',
      `-FilePath ${psLiteral(executable)}`,
      `-WorkingDirectory ${psLiteral(dirname(executable))}`,
      `-ArgumentList ${psLiteral(argumentList)}`,
      '-Verb RunAs',
      '-WindowStyle Hidden'
    ].join(' ')

    this.logger.info('Requesting elevation for the OpenRGB server')
    return new Promise((resolve, reject) => {
      const shell = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true,
        stdio: 'ignore'
      })
      shell.once('error', reject)
      shell.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Le lancement administrateur a été refusé ou a échoué.'))
      )
    })
  }
}
