// Os grupos, as duplas e os jogos de uma categoria, para os separadores da
// página do torneio (Grupos, Quadro, Horário, Os meus jogos).
//
// Resultados quase em tempo real (Renato, 29 set): com a página à frente
// relê-se de REFRESH_MS em REFRESH_MS, e logo ao voltar à app. As tabelas
// do torneio estão fechadas ao browser e a página lê de vistas públicas,
// que não mandam avisos de tempo real — por isso é releitura, não
// subscrição. Só a primeira leitura mostra «a carregar»; as outras trocam
// os dados sem piscar, e uma resposta que chega depois de outra mais nova
// não a apaga.
import { useEffect, useRef, useState } from 'react'
import { getCategoryBoard } from '../../lib/tournamentDraw'
import { errorKind } from '../../lib/errors'

export const REFRESH_MS = 30 * 1000

/** Quem muda o quadro na própria página (passar ao quadro, desfazer, fechar
 *  a categoria) avisa, e o quadro relê logo — antes só se via na releitura
 *  seguinte, ~8 s depois (ensaio do QA, 30 set). */
export const BOARD_CHANGED = 'tournament:board-changed'
export const boardChanged = (categoryId) => window.dispatchEvent(new CustomEvent(BOARD_CHANGED, { detail: { categoryId } }))

export default function useCategoryBoard(categoryId) {
  const [board, setBoard] = useState({ groups: [], entries: {}, matches: [] })
  const [loading, setLoading] = useState(Boolean(categoryId))
  const [notReady, setNotReady] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    let cancelled = false
    if (!categoryId) {
      setBoard({ groups: [], entries: {}, matches: [] })
      setLoading(false)
      return () => { cancelled = true }
    }

    const load = (first) => {
      const mine = ++seq.current
      if (first) setLoading(true)
      getCategoryBoard(categoryId)
        .then((data) => {
          if (cancelled || mine !== seq.current) return
          setBoard(data)
          setNotReady(false)
        })
        .catch((error) => {
          // Enquanto a migração não correr, as vistas não existem: a página
          // mostra o estado vazio em vez de rebentar (mesma regra do Dev 1).
          // Numa releitura sem rede fica o que já se tinha.
          if (!cancelled && first) setNotReady(errorKind(error) === 'not_ready')
        })
        .finally(() => { if (!cancelled && first) setLoading(false) })
    }

    load(true)
    const tick = () => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) load(false)
    }
    const timer = setInterval(tick, REFRESH_MS)
    document.addEventListener('visibilitychange', tick)
    const changed = (e) => { if (!e.detail?.categoryId || e.detail.categoryId === categoryId) load(false) }
    window.addEventListener(BOARD_CHANGED, changed)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener(BOARD_CHANGED, changed)
    }
  }, [categoryId])

  return { ...board, loading, notReady }
}
