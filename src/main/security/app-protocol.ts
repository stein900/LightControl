import { join, normalize, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'

/**
 * The packaged renderer is served from a privileged custom scheme rather than
 * `file://`, as recommended by the Electron security checklist. This gives the
 * UI a real origin for its CSP and confines it to its own bundle; `file://`
 * stays without extra privileges (see the electronFuses configuration).
 */
export const APP_SCHEME = 'app'
export const APP_HOST = 'lightcontrol'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

/** Must run before the `ready` event. */
export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true }
    }
  ])
}

/** Serves files from `rendererRoot`, refusing anything outside of it. */
export function serveRendererBundle(rendererRoot: string): void {
  const root = resolve(rendererRoot)
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 })

    const relativePath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const target = normalize(join(root, relativePath))
    if (!target.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })

    return net.fetch(pathToFileURL(target).toString())
  })
}
