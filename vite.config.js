import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const buildVersion = new Date().toISOString()

function appVersionPlugin() {
  return {
    name: 'sonphu-app-version',
    config() {
      return { define: { __APP_BUILD_VERSION__: JSON.stringify(buildVersion) } }
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'app-version.json',
        source: JSON.stringify({ version: buildVersion }),
      })
    },
  }
}

export default defineConfig({
  plugins: [
    appVersionPlugin(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true
      },
      manifest: {
        name: 'App Nội Bộ Sơn Phú',
        short_name: 'SonPhu',
        description: 'Hệ thống quản lý nội bộ',
        theme_color: '#6b2fa5',
        background_color: '#121212',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ]
})
