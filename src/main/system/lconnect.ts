/**
 * Hands the Lian Li wireless dongle over between L-Connect 3 and LightControl.
 * L-Connect keeps the dongle open exclusively through two system services, and
 * starts its interface with Windows through a scheduled task. Taking over
 * stops them, sets the services to manual start and disables the task;
 * handing back restores automatic start and relaunches everything. Both
 * operations need administrator rights (one UAC prompt each).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import { powershellJson } from './windows-system'

const SERVICES = ['LConnectServiceWatcher', 'LConnectService'] as const
const TASK = 'L-Connect 3'
const PROCESS = 'L-Connect 3'

/**
 * `active`: L-Connect runs and holds the dongle. `autostart`: it is stopped but
 * would start again with Windows. `stopped`: fully handed over to LightControl.
 */
export type LConnectState = 'active' | 'autostart' | 'stopped' | 'absent'

// The task lives in a sub-folder (\LianLi\): it is looked up by name, then piped, so its path never matters.
const task = `Get-ScheduledTask -TaskName '${TASK}'`

const TAKE_OVER_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  `${task} | Disable-ScheduledTask | Out-Null`,
  `Stop-Process -Name '${PROCESS}' -Force`,
  ...SERVICES.map((name) => `Stop-Service -Name '${name}' -Force`),
  ...SERVICES.map((name) => `Set-Service -Name '${name}' -StartupType Manual`)
].join('; ')

const HAND_BACK_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  ...SERVICES.map((name) => `Set-Service -Name '${name}' -StartupType Automatic`),
  ...[...SERVICES].reverse().map((name) => `Start-Service -Name '${name}'`),
  `${task} | Enable-ScheduledTask | Out-Null`,
  `${task} | Start-ScheduledTask`
].join('; ')

const STATE_QUERY = [
  "$service = Get-Service -Name 'LConnectService' -ErrorAction SilentlyContinue",
  `$task = ${task} -ErrorAction SilentlyContinue | Select-Object -First 1`,
  '[pscustomobject]@{ installed = [bool]$service; ' +
    "running = [bool]($service -and $service.Status -ne 'Stopped'); " +
    "automatic = [bool]($service -and [string]$service.StartType -eq 'Automatic'); " +
    "task = [bool]($task -and [string]$task.State -ne 'Disabled') }"
].join('; ')

/** Runs a fixed PowerShell script elevated; resolves false when the UAC prompt is refused. */
function runElevated(script: string): Promise<boolean> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const launcher = `try { Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile -NonInteractive -EncodedCommand ${encoded}'; exit 0 } catch { exit 1 }`
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', launcher], {
      windowsHide: true,
      stdio: 'ignore'
    })
    child.once('error', () => resolve(false))
    child.once('exit', (code) => resolve(code === 0))
  })
}

export function takeOverFromLConnect(): Promise<boolean> {
  return runElevated(TAKE_OVER_SCRIPT)
}

export function handBackToLConnect(): Promise<boolean> {
  return runElevated(HAND_BACK_SCRIPT)
}

/** Where L-Connect stands (no elevation needed). */
export async function lconnectState(): Promise<LConnectState> {
  const [state] = await powershellJson<{
    installed: boolean
    running: boolean
    automatic: boolean
    task: boolean
  }>(STATE_QUERY)
  if (!state?.installed) return 'absent'
  if (state.running) return 'active'
  return state.automatic || state.task ? 'autostart' : 'stopped'
}

const BindingSetSchema = z.array(
  z.object({
    MacStr: z.string().regex(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i),
    iSort: z.number().int().optional()
  })
)

/**
 * Devices the user paired in L-Connect 3, in pairing order, as MAC addresses
 * (aa:bb:cc:dd:ee:ff); null when L-Connect has no pairing list on this PC.
 */
export async function lconnectPairedDevices(): Promise<string[] | null> {
  const programData = process.env['ProgramData'] ?? 'C:\\ProgramData'
  const file = join(programData, 'Lian-Li', 'L-Connect 3', 'slv3', 'config', 'BindingSet.Config')
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = BindingSetSchema.safeParse(JSON.parse(raw.replace(/^\uFEFF/, '')))
    if (!parsed.success) return null
    return [...parsed.data]
      .sort((a, b) => (a.iSort ?? 0) - (b.iSort ?? 0))
      .map((entry) => entry.MacStr.toLowerCase())
  } catch {
    return null
  }
}
