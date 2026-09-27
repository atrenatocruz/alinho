import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './lib/i18n'
import { installDevMockNetwork } from './lib/devMockNetwork'
import { reloadOnceForChunk } from './lib/chunkReload'
import { registerSW } from 'virtual:pwa-register'
import { setupAppUpdate } from './lib/appUpdate'
import { IS_TEST_ENV } from './lib/appEnv'
import TestEnvBanner from './components/TestEnvBanner'

// A app instalada apanha a versão nova sem ter de ser fechada (#569, QA 26 set).
if (import.meta.env.PROD) setupAppUpdate(registerSW)

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
  </React.StrictMode>,
)


