/**
 * Downloads the pinned third-party runtimes into vendor/ so they can be used in
 * development and shipped as extra resources by electron-builder:
 *
 * - OpenRGB (GPL-2.0), run as a separate process and driven through its SDK
 *   network protocol.
 * - The Corsair iCUE SDK runtime (redistributable DLL), loaded in an isolated
 *   utility process to drive Corsair devices through iCUE.
 *
 * Usage: node scripts/fetch-vendor.mjs [--force]
 */
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const force = process.argv.includes('--force')

const ARTIFACTS = [
  {
    name: 'OpenRGB 1.0',
    url: 'https://codeberg.org/OpenRGB/OpenRGB/releases/download/release_1.0/OpenRGB_1.0_Windows_64_81bbe18.zip',
    target: join(root, 'vendor', 'openrgb'),
    /** Copies the folder holding OpenRGB.exe. */
    install: async (extracted, target) => {
      const source = findFileDir(extracted, 'openrgb.exe')
      if (!source) throw new Error('OpenRGB.exe not found in the archive.')
      renameSync(source, target)
      const license = await download('https://codeberg.org/OpenRGB/OpenRGB/raw/tag/release_1.0/LICENSE')
      writeFileSync(join(target, 'LICENSE.txt'), license)
      writeFileSync(
        join(target, 'NOTICE.txt'),
        'OpenRGB 1.0 is distributed under the GNU General Public License v2.0 (see LICENSE.txt).\n' +
          'It runs as a separate program; LightControl communicates with it over the OpenRGB SDK network protocol.\n' +
          'Corresponding source code: https://codeberg.org/OpenRGB/OpenRGB/src/tag/release_1.0\n'
      )
    }
  },
  {
    name: 'iCUE SDK 4.0.84',
    url: 'https://github.com/CorsairOfficial/cue-sdk/releases/download/v4.0.84/iCUESDK_4.0.84.zip',
    target: join(root, 'vendor', 'icuesdk'),
    /** Keeps only the redistributable x64 runtime. */
    install: async (extracted, target) => {
      const source = findFileDir(extracted, 'icuesdk.x64_2019.dll')
      if (!source) throw new Error('iCUESDK.x64_2019.dll not found in the archive.')
      mkdirSync(target, { recursive: true })
      copyFileSync(join(source, 'iCUESDK.x64_2019.dll'), join(target, 'iCUESDK.x64_2019.dll'))
      writeFileSync(
        join(target, 'NOTICE.txt'),
        'Corsair iCUE SDK 4.0.84 redistributable runtime (redist/x64), (c) Corsair.\n' +
          'Source: https://github.com/CorsairOfficial/cue-sdk\n'
      )
    }
  }
]

function findFileDir(dir, fileName) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      const found = findFileDir(full, fileName)
      if (found) return found
    } else if (entry.toLowerCase() === fileName) {
      return dir
    }
  }
  return null
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

async function fetchArtifact(artifact) {
  const marker = join(artifact.target, '.release')
  if (!force && existsSync(marker) && readFileSync(marker, 'utf8').trim() === artifact.url) {
    console.log(`[vendor] ${artifact.name} already present.`)
    return
  }

  const work = join(tmpdir(), `lightcontrol-vendor-${Date.now()}`)
  const archive = join(work, 'archive.zip')
  const extracted = join(work, 'extracted')
  mkdirSync(extracted, { recursive: true })
  try {
    console.log(`[vendor] Downloading ${artifact.name}...`)
    const response = await fetch(artifact.url, { redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${artifact.url}`)
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))

    // Windows ships bsdtar, which reads zip archives; a GNU tar earlier in PATH (Git Bash) does not.
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    execFileSync(tar, ['-xf', archive, '-C', extracted], { stdio: 'inherit' })

    rmSync(artifact.target, { recursive: true, force: true })
    mkdirSync(dirname(artifact.target), { recursive: true })
    await artifact.install(extracted, artifact.target)
    writeFileSync(marker, `${artifact.url}\n`)
    console.log(`[vendor] ${artifact.name} installed into ${artifact.target}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('[vendor] Skipped: the bundled runtimes are only provided for Windows.')
    return
  }
  for (const artifact of ARTIFACTS) await fetchArtifact(artifact)
}

main().catch((error) => {
  console.error(`[vendor] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
