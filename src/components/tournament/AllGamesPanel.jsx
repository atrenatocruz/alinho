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
import { Suspense, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MonoLabel } from './TournamentBits'
import { TOURNAMENT_PANELS } from './panels'

const SECTIONS = ['groups', 'draw', 'calendar']

export default function AllGamesPanel({ sections = SECTIONS, ...props }) {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const target = params.get('sec')
  const refs = useRef({})
  const spinner = <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-7 w-7 border-[3px] border-ink-50 border-t-ink-700" /></div>

  // Só eliminatórias (formato com 0 grupos): a secção Grupos não aparece —
  // mostrava «Grupos ainda não sorteados» num torneio que nunca os terá
  // (QA, 26 set). Sem formato escolhido ainda, fica.
  const format = props.category?.format
  const noGroups = format && Number(format.groups) === 0
  const built = sections.filter((key) => TOURNAMENT_PANELS[key] && !(key === 'groups' && noGroups))
  // «A decorrer agora» (27 set): o toque no cartão do torneio abre aqui com
  // ?sec=groups|draw, já na secção da fase a decorrer. Os painéis carregam
  // aos poucos e empurram o que está por baixo, por isso volta a apontar
  // enquanto a página assenta — e pára logo que a pessoa mexa.
  useEffect(() => {
    if (!target || !SECTIONS.includes(target)) return undefined
    let stopped = false
    const stop = () => { stopped = true }
    const go = () => { if (!stopped) refs.current[target]?.scrollIntoView({ block: 'start' }) }
    const timers = [0, 300, 800, 1500].map((ms) => setTimeout(go, ms))
    const events = ['wheel', 'touchstart', 'keydown']
    events.forEach((e) => window.addEventListener(e, stop, { passive: true }))
    return () => { timers.forEach(clearTimeout); events.forEach((e) => window.removeEventListener(e, stop)) }
  }, [target])

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
          <section key={key} ref={(el) => { refs.current[key] = el }} className="scroll-mt-20">
            <MonoLabel>{t(`tournament.section_${key}`)}</MonoLabel>
            {/* A linha por baixo do título está no desenho: com três secções
                seguidas, o título sozinho não diz qual é qual a quem chega. */}
            {/* Sem inscrição não há «tua tabela» (designer, 28 set). */}
            <p className="mb-1.5 mt-0.5 text-xs text-ink-500">{t(key === 'groups' && !props.my ? 'tournament.section_groups_hint_open' : `tournament.section_${key}_hint`)}</p>
            <Suspense fallback={spinner}><Panel {...props} /></Suspense>
          </section>
        )
      })}
    </div>
  )
}
