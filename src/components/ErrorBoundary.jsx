import { Component } from 'react'
import { RotateCcw } from 'lucide-react'
import i18n from '../lib/i18n'
import { isChunkLoadError, reloadOnceForChunk } from '../lib/chunkReload'

/**
 * Rede de segurança para o ecrã branco (Francisco, 22 set 2026).
 *
 * Sem isto, qualquer erro a desenhar uma página deixa o ecrã em branco, sem
 * mensagem nenhuma: o React desmonta a árvore toda e não põe nada no lugar.
 * Quem está a usar a app não tem como saber o que aconteceu, nem que basta
 * recarregar. Aqui aparece um ecrã com o botão que resolve.
 *
 * Propositadamente sem nada do resto da app: nem tradução por hook, nem
 * componentes de UI, nem contextos. Uma rede de segurança que depende de
 * coisas que também podem falhar não é rede de segurança.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false, reloading: false }
  }

  // Falta um pedaço da app depois de uma publicação nova (#569): recarrega
  // sozinha uma vez, sem mostrar o erro. Os painéis do torneio carregam-se
  // à parte e não passavam pelo recarregamento das páginas (App.jsx).
  static getDerivedStateFromError(error) {
    return { failed: true, reloading: isChunkLoadError(error) }
  }

  componentDidCatch(error, info) {
    if (this.state.reloading && reloadOnceForChunk()) return
    if (this.state.reloading) this.setState({ reloading: false })
    console.error('Erro não apanhado:', error, info?.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    // A recarregar: nada de ecrã de erro por um instante.
    if (this.state.reloading) return <div className="min-h-screen bg-canvas" />

    const t = (key, fallback) => {
      try {
        const value = i18n.t(key)
        return value === key ? fallback : value
      } catch {
        return fallback
      }
    }

    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-canvas">
        <div className="card max-w-sm w-full text-center space-y-3">
          <h1 className="text-lg text-ink-900">{t('errorboundary.title', 'Alguma coisa correu mal')}</h1>
          <p className="text-sm text-muted">
            {t('errorboundary.text', 'Não conseguimos mostrar esta página. Recarregar costuma resolver.')}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-ctrl bg-ink-900 text-white text-sm font-extrabold"
          >
            <RotateCcw size={16} />
            {t('errorboundary.reload', 'Recarregar')}
          </button>
        </div>
      </div>
    )
  }
}
