import type { Logger } from '@main/core/logger'
import { isElevated, isServiceInstalled, memoryModules, runningProcesses } from '@main/system/windows-system'
import type { ConflictReport, DeviceInfo, Diagnostics, UnsupportedHardware } from '@shared/model'

/** Vendor software that writes to the same controllers and can override LightControl. */
const KNOWN_CONFLICTS: ConflictReport[] = [
  {
    id: 'msi-mystic-light',
    product: 'MSI Center · Mystic Light',
    processes: ['LEDKeeper2.exe', 'Mystic_Light_Service.exe', 'LightKeeperService.exe'],
    affects: 'Carte mère MSI : headers JRGB et JRAINBOW (AIO, ventilateurs, bandeaux).',
    advice:
      'Dans MSI Center, désinstallez le module Mystic Light (Fonctionnalités) ou désactivez son éclairage. Sinon, il réapplique ses propres couleurs au démarrage et en sortie de veille.'
  },
  {
    id: 'logitech-ghub',
    product: 'Logitech G HUB',
    processes: ['lghub_agent.exe', 'lghub.exe', 'lghub_system_tray.exe'],
    affects: 'Souris et clavier Logitech.',
    advice:
      'G HUB peut reprendre la main sur l’éclairage. Désactivez LIGHTSYNC pour vos appareils dans G HUB, ou quittez G HUB si vous n’en avez pas besoin.'
  },
  {
    id: 'signalrgb',
    product: 'SignalRGB',
    processes: ['SignalRgb.exe', 'SignalRgbLauncher.exe'],
    affects: 'Tous les appareils qu’il contrôle.',
    advice: 'Quittez SignalRGB : deux moteurs d’éclairage ne peuvent pas piloter le même matériel.'
  },
  {
    id: 'lian-li-lconnect',
    product: 'Lian Li L-Connect 3',
    processes: ['L-Connect-Service.exe', 'L-Connect 3.exe', 'LConnect3.exe'],
    affects: 'Appareils Lian Li sans fil (Strimer Plus Wireless, UNI FAN Wireless).',
    advice:
      'L-Connect 3 garde le dongle sans fil pour lui. Utilisez « Prendre le contrôle » dans Intégrations : LightControl arrête L-Connect et pilote vos appareils Lian Li. « Rendre la main » rétablit L-Connect à l’identique.'
  },
  {
    id: 'asus-armoury',
    product: 'ASUS Armoury Crate',
    processes: ['ArmouryCrate.exe', 'LightingService.exe'],
    affects: 'Appareils ASUS Aura.',
    advice: 'Désactivez Aura Sync dans Armoury Crate ou désinstallez son service d’éclairage.'
  },
  {
    id: 'nzxt-cam',
    product: 'NZXT CAM',
    processes: ['NZXT CAM.exe'],
    affects: 'Appareils NZXT.',
    advice: 'Quittez NZXT CAM pendant que LightControl pilote vos appareils NZXT.'
  }
]

export class DiagnosticsService {
  private latest: Diagnostics | null = null
  private running: Promise<Diagnostics> | null = null

  constructor(
    private readonly logDirectory: string,
    private readonly logger: Logger
  ) {}

  get current(): Diagnostics | null {
    return this.latest
  }

  refresh(devices: readonly DeviceInfo[]): Promise<Diagnostics> {
    this.running ??= this.collect(devices).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async collect(devices: readonly DeviceInfo[]): Promise<Diagnostics> {
    const [elevated, pawnIo, processes, memory] = await Promise.all([
      isElevated(),
      isServiceInstalled('PawnIO'),
      runningProcesses(),
      memoryModules()
    ])

    const conflicts: ConflictReport[] = []
    for (const conflict of KNOWN_CONFLICTS) {
      const running = conflict.processes.filter((name) => processes.has(name.toLowerCase()))
      if (running.length > 0) conflicts.push({ ...conflict, processes: running })
    }

    const unsupported: UnsupportedHardware[] = []

    const corsairMemory = memory.filter((module) => /^CM[A-Z0-9]+/i.test(module.PartNumber?.trim() ?? ''))
    const hasMemoryDevice = devices.some((device) => device.kind === 'memory')
    if (corsairMemory.length > 0 && !hasMemoryDevice) {
      const part = corsairMemory[0]?.PartNumber?.trim() ?? ''
      unsupported.push({
        id: 'corsair-memory',
        name: `Mémoire Corsair ${part}`.trim(),
        detail:
          'LightControl pilote la RAM Corsair au travers d’iCUE : laissez iCUE ouvert et vérifiez que son SDK est activé dans ses réglages. ' +
          (pawnIo
            ? 'Autre possibilité : PawnIO étant installé, le moteur OpenRGB peut y accéder en mode administrateur.'
            : 'Autre possibilité : installer le pilote PawnIO (pawnio.eu) et activer le mode administrateur du moteur.')
      })
    }

    const diagnostics: Diagnostics = {
      checkedAt: Date.now(),
      isElevated: elevated,
      pawnIoInstalled: pawnIo,
      conflicts,
      unsupported,
      logDirectory: this.logDirectory
    }
    this.logger.info('Diagnostics', {
      elevated,
      pawnIo,
      conflicts: conflicts.map((c) => c.id),
      unsupported: unsupported.map((u) => u.id)
    })
    this.latest = diagnostics
    return diagnostics
  }
}
