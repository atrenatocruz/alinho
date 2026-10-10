// Jogo em aberto no Gerir › Eventos: um cartão por dia, com uma pastilha por
// hora (SPEC design-handoff/2026-10-07-jogo-em-aberto-passo-a-passo, ponto 1,
// aprovado pelo Francisco a 9 out: «isto deveria ser só um card com todas as
// horas escolhidas»). Tocar numa hora abre esse jogo; «Editar» abre o editar
// do dia.
import { useTranslation } from 'react-i18next'
import { KIND_STYLE } from '../agenda/EventCard'
import { formatTime } from '../../lib/formatDate'

/** Quantos estão num horário: cada inscrição conta 1, e 2 se vier com dupla. */
export const slotPeople = (game) => (game.participants || [])
  .filter((p) => p.status === 'confirmed')
  .reduce((n, p) => n + 1 + (p.partner_id || p.partner_guest_id ? 1 : 0), 0)

export default function OpenDayCard({ titulo, jogos, onOpen, onEdit }) {
  const { t, i18n } = useTranslation()
  const cor = KIND_STYLE.open
  const Icone = cor.icon
  const inscritos = jogos.reduce((n, g) => n + slotPeople(g), 0)
  return (
    // «Editar» no canto, à altura da etiqueta: as horas ficam com a largura toda.
    <div className={`relative rounded-ctrl border ${cor.card}`}>
      <div className="min-w-0 p-4">
        <span className={`inline-flex items-center gap-1 text-[11px] font-extrabold px-2 py-1 rounded-full bg-white ${cor.text}`}>
          <Icone size={12} /> {t('gerirclube.event_label_open')}
        </span>
        <p className="text-lg font-semibold mt-1 truncate text-ink-900">{titulo}</p>
        <p className="text-sm text-muted mt-0.5">
          {[t('openday.slots', { count: jogos.length }), t('openday.signed', { count: inscritos })].join(' · ')}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {jogos.map((g) => {
            const n = slotPeople(g)
            return (
              <button key={g.id} type="button" onClick={() => onOpen(g)}
                className={`min-h-[34px] rounded-ctrl border bg-white px-2.5 text-[13px] font-extrabold text-ink-900 ${n > 0 ? 'border-ok' : 'border-line'}`}>
                {formatTime(g.date, i18n.language, { hour: '2-digit', minute: '2-digit' })}
                <span className="ml-1 font-semibold text-muted">{n}/{g.max_players || 4}</span>
              </button>
            )
          })}
        </div>
      </div>
      {onEdit && (
        <button type="button" onClick={onEdit}
          className="absolute right-0 top-0 min-h-[44px] px-4 pt-4 pb-2 text-sm font-extrabold text-ink-900 rounded-tr-ctrl hover:bg-white/60">
          {t('gerirclube.edit_action')}
        </button>
      )}
    </div>
  )
}
