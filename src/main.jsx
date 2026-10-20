import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './lib/i18n'
// Apanha o beforeinstallprompt do Android antes de a app montar.
import './lib/installPrompt'
import { installDevMockNetwork } from './lib/devMockNetwork'
import { reloadOnceForChunk } from './lib/chunkReload'
import { Workbox } from 'workbox-window'
import { setupAppUpdate } from './lib/appUpdate'
import { IS_TEST_ENV } from './lib/appEnv'
import { IS_NATIVE } from './lib/native'
import { setupNativeShell } from './lib/nativeShell'
import TestEnvBanner from './components/TestEnvBanner'
import UpdatePill from './components/UpdatePill'

// A versão nova: avisa com a app à frente (UpdatePill) e só entra sozinha
// ao voltar à app depois de algum tempo fora (#569, revisto a 29 set).
// Na app das lojas não há service worker: os ficheiros já vêm dentro da app,
// e a versão nova chega pela loja.
if (import.meta.env.PROD && !IS_NATIVE && 'serviceWorker' in navigator) {
  setupAppUpdate(() => new Workbox('/sw.js', { scope: '/' }))
}

// Só na app das lojas: botão «voltar», barra das horas, links e a volta do
// login com o Google.
setupNativeShell()

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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TestEnvBanner />
    <App />
    <UpdatePill />
  </React.StrictMode>,
)
// A app montou: o vigia do index.html já não mostra «Não foi possível abrir
// o alinho» (14 out).
window.__alinhoUp = true


