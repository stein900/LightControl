import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@main': resolve(__dirname, 'src/main'),
  '@renderer': resolve(__dirname, 'src/renderer/src')
}

/**
 * Injects a Content-Security-Policy meta tag. The development policy relaxes
 * inline scripts and websockets for the Vite HMR client; production is strict.
 */
function contentSecurityPolicy(): Plugin {
  const production = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
  const development = production
    .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    .replace("connect-src 'self'", "connect-src 'self' ws: http://localhost:*")

  let policy = production
  return {
    name: 'lightcontrol:csp',
    configResolved(config) {
      policy = config.command === 'serve' ? development : production
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Runs in an Electron utility process, isolated from the main process.
          'icue-host': resolve(__dirname, 'src/main/hardware/icue/icue-host.ts'),
          'lianli-host': resolve(__dirname, 'src/main/hardware/lianli/lianli-host.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react(), contentSecurityPolicy()],
    build: {
      target: 'chrome130',
      minify: 'esbuild',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
