// «Todos os jogos» — o separador do meio, desde 23 set (desenho
// `wireframes/pagina-do-torneio-3-separadores.html`, entrega ponto 1).
//
// Grupos, Quadro e Calendário deixaram de ser três separadores: são três
// maneiras de olhar para os MESMOS jogos — com quem jogo, até onde posso
// ir, e a que horas. Aqui ficam empilhados, cada um com o seu título, numa
// página que rola. As palavras não se perdem: passam de separador a título
// de secção.
//
// Nenhum painel é reescrito. Vêm do registo `panels.js` tal como estavam, e
// o Dev 3 continua dono deles — esta é só a moldura por cima.
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { MonoLabel } from './TournamentBits'
import { TOURNAMENT_PANELS } from './panels'

const SECTIONS = ['groups', 'draw', 'calendar']

export default function AllGamesPanel(props) {
  const { t } = useTranslation()
  const spinner = <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-7 w-7 border-[3px] border-ink-50 border-t-ink-700" /></div>

  const built = SECTIONS.filter((key) => TOURNAMENT_PANELS[key])
  if (built.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line px-4 py-8 text-center">
        <p className="text-sm text-ink-500">{t('tournament.tab_not_built')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {built.map((key) => {
        const Panel = TOURNAMENT_PANELS[key]
        return (
          <section key={key}>
            <MonoLabel>{t(`tournament.section_${key}`)}</MonoLabel>
            {/* A linha por baixo do título está no desenho: com três secções
                seguidas, o título sozinho não diz qual é qual a quem chega. */}
            <p className="mb-1.5 mt-0.5 text-xs text-ink-500">{t(`tournament.section_${key}_hint`)}</p>
            <Suspense fallback={spinner}><Panel {...props} /></Suspense>
          </section>
        )
      })}
    </div>
  )
}
