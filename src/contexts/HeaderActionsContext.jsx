import { createContext, useContext } from 'react'

// Notificações + logout — a lógica (que pedidos existem, convites, etc.)
// continua toda no Layout, mas o ícone já não vive numa barra escura fixa
// global: cada página principal (Jogos, Comunidade, Rankings, Gerir, Perfil)
// mostra-o dentro do seu próprio título fixo (PageHeader em components/ui.jsx),
// lido daqui em vez de recebido por prop através do App.jsx.
const HeaderActionsContext = createContext(null)
export const HeaderActionsProvider = HeaderActionsContext.Provider
export const useHeaderActions = () => useContext(HeaderActionsContext)
