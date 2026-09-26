import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Quem decide quando recarregar a página aberta é src/lib/appUpdate.js
      // (uma vez, nunca a meio de um formulário, #569). O service worker novo
      // ativa logo (skipWaiting/clientsClaim, em baixo).
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'robots.txt', 'apple-touch-icon.png'],
      manifest: {
        name: 'alinho',
        short_name: 'alinho',
        description: 'A comunidade de jogadores, grupos e clubes de padel.',
        theme_color: '#040404',
        background_color: '#FFFFFF',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        // Sem o index.html na cache (#569): a página vem sempre da rede, e um
        // refresh abre logo a versão nova. Antes vinha da cache e eram
        // precisos vários refreshes até «limpar» (Francisco, 26 set).
        globPatterns: ['**/*.{js,css,ico,png,svg}'],
        navigateFallback: null,
        // Só se a rede falhar é que se usa a última página guardada.
        runtimeCaching: [{
          urlPattern: ({ request }) => request.mode === 'navigate',
          handler: 'NetworkFirst',
          options: { cacheName: 'paginas', networkTimeoutSeconds: 4 },
        }],
        // A versão nova ativa logo, sem esperar que se fechem todas as abas,
        // e apaga a cache da versão anterior.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      }
    })
  ]
})


