/**
 * Hands the Lian Li wireless dongle over between L-Connect 3 and LightControl.
 * L-Connect keeps the dongle open exclusively through two system services and
 * a scheduled task for its interface. Taking over stops them and sets them to
 * manual start; handing back restores automatic start and relaunches them.
 * Both operations need administrator rights (one UAC prompt each).
 */
import { execFile, spawn } from 'node:child_process'

const SERVICES = ['LConnectServiceWatcher', 'LConnectService'] as const
const TASK = 'L-Connect 3'
const PROCESS = 'L-Connect 3'

export type LConnectState = 'running' | 'stopped' | 'absent'

const TAKE_OVER_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  `Disable-ScheduledTask -TaskName '${TASK}' | Out-Null`,
  `Stop-Process -Name '${PROCESS}' -Force`,
  ...SERVICES.map((name) => `Stop-Service -Name '${name}' -Force`),
  ...SERVICES.map((name) => `Set-Service -Name '${name}' -StartupType Manual`)
].join('; ')

const HAND_BACK_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  ...SERVICES.map((name) => `Set-Service -Name '${name}' -StartupType Automatic`),
  ...[...SERVICES].reverse().map((name) => `Start-Service -Name '${name}'`),
  `Enable-ScheduledTask -TaskName '${TASK}' | Out-Null`,
  `Start-ScheduledTask -TaskName '${TASK}'`
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

/** Whether L-Connect's main service is installed and running (no elevation needed). */
export function lconnectState(): Promise<LConnectState> {
  if (process.platform !== 'win32') return Promise.resolve('absent')
  return new Promise((resolve) => {
    execFile(
      'sc.exe',
      ['query', 'LConnectService'],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        if (error && !stdout) return resolve('absent')
        resolve(
          /RUNNING|START_PENDING/.test(stdout) ? 'running' : /STATE/.test(stdout) ? 'stopped' : 'absent'
        )
      }
    )
  })
}
