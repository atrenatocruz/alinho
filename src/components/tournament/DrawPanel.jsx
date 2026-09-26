// Separador «Quadro» da página do torneio (Trello #364, «Torneio 4/6»).
// Desenho: SPEC §4 (quadro de eliminatórias) e «Sorteio feito · M4».
//
// Abre sem conta. Enquanto não se sabe quem joga, mostra-se o TEXTO que o
// sorteio guardou («2.º do Grupo B») em vez de um espaço vazio — é o que
// deixa o jogador perceber o caminho dele até à final.
import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import { EmptyState } from '../ui'
import { MonoLabel } from './TournamentBits'
import useCategoryBoard from './useCategoryBoard'
import { bracketRounds } from '../../lib/tournamentDraw'
import BracketTree from './BracketTree'

export default function DrawPanel({ category, myEntries }) {
  const { t } = useTranslation()
  const { entries, matches, loading } = useCategoryBoard(category?.id)

  if (loading) {
    return <p className="py-6 text-center text-xs text-muted">{t('common.loading')}</p>
  }

  const main = bracketRounds(matches, 'principal')
  const secondary = bracketRounds(matches, 'secundario')

  if (!main.length && !secondary.length) {
    return (
      <EmptyState
        icon={Trophy}
        title={t('tournament.draw.bracket_empty_title')}
        subtitle={t('tournament.draw.bracket_empty_subtitle')}
      />
    )
  }

  // A dupla de quem vê, nesta categoria: fica a verde e o quadro abre no
  // caminho dela (#571, ponto 4).
  const myIds = (myEntries || []).filter((e) => e.category_id === category?.id).map((e) => e.entry_id).filter(Boolean)

  // O quadro em árvore (#571). O secundário usa o mesmo desenho, por baixo
  // do principal (ponto 6).
  const Bracket = ({ rounds, label }) => (
    <div className="mb-5">
      {secondary.length > 0 && <MonoLabel className="mb-1">{label}</MonoLabel>}
      <BracketTree rounds={rounds} entries={entries} myIds={myIds} />
    </div>
  )

  return (
    <div>
      {main.length ? <Bracket rounds={main} label={t('tournament.draw.bracket_main')} /> : null}
      {secondary.length ? (
        <Bracket rounds={secondary} label={t('tournament.draw.bracket_secondary')} />
      ) : null}
    </div>
  )
}
