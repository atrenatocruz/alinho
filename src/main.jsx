import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './lib/i18n'
import { installDevMockNetwork } from './lib/devMockNetwork'
import { reloadOnceForChunk } from './lib/chunkReload'
import { Workbox } from 'workbox-window'
import { setupAppUpdate } from './lib/appUpdate'
import { IS_TEST_ENV } from './lib/appEnv'
import TestEnvBanner from './components/TestEnvBanner'
import UpdatePill from './components/UpdatePill'

// A versão nova: avisa com a app à frente (UpdatePill) e só entra sozinha
// ao voltar à app depois de algum tempo fora (#569, revisto a 29 set).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  setupAppUpdate(() => new Workbox('/sw.js', { scope: '/' }))
}

// O Vite avisa quando um ficheiro pré-carregado de uma página já não existe
// (publicação nova com a app aberta, #569): recarrega-se uma vez em vez de
// deixar o erro chegar ao ecrã.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForChunk()) event.preventDefault()
})

// No-op fora de DEV e fora da sessão "Entrar como Admin" — ver o próprio
// ficheiro para o porquê.
installDevMockNetwork()

// O site de testes (#585): a classe liga as regras de index.css que abrem
// espaço à faixa «Ambiente de testes».
if (IS_TEST_ENV) document.documentElement.classList.add('test-env')

// O ecrã de arranque do index.html sai depois de a app desenhar o primeiro
// ecrã (o SplashScreen tem o mesmo fundo, por isso a troca não se nota).
function BootGone() {
  React.useEffect(() => { document.getElementById('boot')?.remove() }, [])
  return null
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BootGone />
    <TestEnvBanner />
    <App />
    <UpdatePill />
  </React.StrictMode>,
)


