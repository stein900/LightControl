/**
 * Read-only queries against Windows. Every command is a fixed string with no
 * user input, executed without a shell and with a timeout.
 */
import { execFile } from 'node:child_process'

const TIMEOUT_MS = 8000

function run(file: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        resolve({ code, stdout: stdout ?? '' })
      }
    )
  })
}

/** True when the process runs with a high integrity level (elevated administrator). */
export async function isElevated(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const { stdout } = await run('whoami.exe', ['/groups'])
  return stdout.includes('S-1-16-12288')
}

export async function isServiceInstalled(name: string): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const { code } = await run('sc.exe', ['query', name])
  return code === 0
}

/** Image names of running processes, lower-cased. */
export async function runningProcesses(): Promise<Set<string>> {
  if (process.platform !== 'win32') return new Set()
  const { stdout } = await run('tasklist.exe', ['/fo', 'csv', '/nh'])
  const names = new Set<string>()
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^"([^"]+)"/.exec(line)
    if (match?.[1]) names.add(match[1].toLowerCase())
  }
  return names
}

async function powershellJson<T>(command: string): Promise<T[]> {
  if (process.platform !== 'win32') return []
  const { code, stdout } = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `${command} | ConvertTo-Json -Compress`
  ])
  if (code !== 0 || !stdout.trim()) return []
  try {
    const parsed: unknown = JSON.parse(stdout)
    return (Array.isArray(parsed) ? parsed : [parsed]) as T[]
  } catch {
    return []
  }
}

interface ProcessEntry {
  ProcessId: number
  ExecutablePath: string | null
}

/** Process IDs of running instances of the given executable (matched on its full path). */
export async function processIdsByPath(executable: string): Promise<number[]> {
  const name = executable.split(/[\\/]/).pop() ?? ''
  if (!/^[\w .-]+\.exe$/i.test(name)) return []
  const entries = await powershellJson<ProcessEntry>(
    `Get-CimInstance Win32_Process -Filter "Name='${name}'" | Select-Object ProcessId, ExecutablePath`
  )
  const target = executable.toLowerCase()
  return entries
    .filter((entry) => entry.ExecutablePath?.toLowerCase() === target)
    .map((entry) => entry.ProcessId)
}

export interface MemoryModule {
  Manufacturer: string | null
  PartNumber: string | null
}

export function memoryModules(): Promise<MemoryModule[]> {
  return powershellJson<MemoryModule>(
    'Get-CimInstance Win32_PhysicalMemory | Select-Object Manufacturer, PartNumber'
  )
}
