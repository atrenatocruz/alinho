import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// O site de testes (teste.alinho.pt, #585): com VITE_APP_ENV=test (só no
// Preview do ramo dev, na Vercel) a app instalada chama-se «alinho TESTE»,
// tem o ícone com a fita cor de laranja e a barra das horas cor de laranja.
// Só o valor exato 'test' — sem ele, tudo como no alinho.pt. A faixa no topo
// das páginas está em src/lib/appEnv.js.
const TEST_ORANGE = '#EA580C'

// O título, o ícone do separador, o do iPhone e a cor da barra das horas
// vêm do index.html: trocam-se aqui, no build.
const testEnvHtml = (isTest) => ({
  name: 'alinho-test-env-html',
  transformIndexHtml: (html) => (!isTest ? html : html
    .replace('<title>alinho.pt</title>', '<title>alinho TESTE</title>')
    .replace('href="/favicon.ico"', 'href="/favicon-teste.ico"')
    .replace('href="/apple-touch-icon.png"', 'href="/apple-touch-icon-teste.png"')
    .replace('<meta name="theme-color" content="#040404" />', `<meta name="theme-color" content="${TEST_ORANGE}" />`)
    .replace('</head>', '  <meta name="apple-mobile-web-app-title" content="alinho TESTE" />\n  </head>')),
})

export default defineConfig(({ mode }) => {
  const isTest = loadEnv(mode, process.cwd(), 'VITE_').VITE_APP_ENV === 'test'
  const icon = (file) => (isTest ? file.replace(/\.(png|ico)$/, '-teste.$1') : file)
  return {
  plugins: [
    react(),
    testEnvHtml(isTest),
    VitePWA({
      // Quem decide quando a versão nova entra é src/lib/appUpdate.js: fica à
      // espera até a pessoa tocar em «Atualizar», ou até voltar à app depois
      // de algum tempo fora (#569, revisto a 29 set).
      registerType: 'prompt',
      // O registo do service worker é feito à mão (main.jsx, workbox-window):
      // o plugin não mete o dele, que recarregava a página sozinho.
      injectRegister: false,
      includeAssets: [icon('favicon.ico'), 'robots.txt', icon('apple-touch-icon.png')],
      manifest: {
        name: isTest ? 'alinho TESTE' : 'alinho',
        short_name: isTest ? 'alinho TESTE' : 'alinho',
        description: 'A comunidade de jogadores, grupos e clubes de padel.',
        theme_color: isTest ? TEST_ORANGE : '#040404',
        background_color: '#FFFFFF',
        display: 'standalone',
        icons: [
          {
            src: icon('pwa-192x192.png'),
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: icon('pwa-512x512.png'),
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: icon('maskable-icon-512x512.png'),
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
        // A versão nova NÃO ativa sozinha (29 set): ativá-la logo apagava os
        // ficheiros da versão aberta, e ao mudar de ecrã a página pedia um
        // que já não existia e recarregava (o «refresh maluco»). À espera, o
        // service worker antigo continua a servir a versão aberta; quem a
        // ativa é o appUpdate.js. A cache antiga só se apaga depois disso.
        skipWaiting: false,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      }
    })
  ]
  }
})


