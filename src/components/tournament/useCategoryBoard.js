// Uma leitura só, partilhada pelos três separadores do «Torneio 4/6»
// (Grupos, Quadro e Calendário): sem isto cada um pedia as mesmas três
// listas à base de dados e num wi-fi de clube isso nota-se.
import { useEffect, useState } from 'react'
import { getCategoryBoard } from '../../lib/tournamentDraw'
import { errorKind } from '../../lib/errors'

export default function useCategoryBoard(categoryId) {
  const [board, setBoard] = useState({ groups: [], entries: {}, matches: [] })
  const [loading, setLoading] = useState(Boolean(categoryId))
  const [notReady, setNotReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!categoryId) {
      setBoard({ groups: [], entries: {}, matches: [] })
      setLoading(false)
      return () => { cancelled = true }
    }
    setLoading(true)
    getCategoryBoard(categoryId)
      .then((data) => { if (!cancelled) { setBoard(data); setNotReady(false) } })
      .catch((error) => {
        // Enquanto a migração não correr, as vistas não existem: a página
        // mostra o estado vazio em vez de rebentar (mesma regra do Dev 1).
        if (!cancelled) setNotReady(errorKind(error) === 'not_ready')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [categoryId])

  return { ...board, loading, notReady }
}
