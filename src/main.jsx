import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './lib/i18n'
import { installDevMockNetwork } from './lib/devMockNetwork'

// No-op fora de DEV e fora da sessão "Entrar como Admin" — ver o próprio
// ficheiro para o porquê.
installDevMockNetwork()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)


