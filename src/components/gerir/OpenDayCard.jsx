// Jogo em aberto no Gerir › Eventos: um cartão por dia, com uma pastilha por
// hora (SPEC design-handoff/2026-10-07-jogo-em-aberto-passo-a-passo, ponto 1,
// aprovado pelo Francisco a 9 out: «isto deveria ser só um card com todas as
// horas escolhidas»). Tocar numa hora abre esse jogo; «Editar» abre o editar
// do dia.
import { useTranslation } from 'react-i18next'
import { KIND_COLORS } from '../../lib/kindColors'
import { formatTime } from '../../lib/formatDate'

/** Quantos estão num horário: cada inscrição conta 1, e 2 se vier com dupla. */
export const slotPeople = (game) => (game.participants || [])
  .filter((p) => p.status === 'confirmed')
  .reduce((n, p) => n + 1 + (p.partner_id || p.partner_guest_id ? 1 : 0), 0)

export default function OpenDayCard({ titulo, jogos, onOpen, onEdit }) {
  const { t, i18n } = useTranslation()
  const cor = KIND_COLORS.open
  const inscritos = jogos.reduce((n, g) => n + slotPeople(g), 0)
  return (
    // R9 (13 out): cartão branco com a barra laranja à esquerda; as horas em
    // pastilhas, as que já têm gente a cheio. «Editar» no canto.
    <div className="relative overflow-hidden rounded-[18px] bg-white shadow-card">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5" style={{ background: cor.strong }} />
      <div className="min-w-0 py-3.5 pl-5 pr-4">
        <p className="pr-20 text-[16px] font-extrabold text-ink-900">{t('gerirclube.open_day_title', { day: titulo })}</p>
        <p className="mt-0.5 text-sm text-muted">
          {[t('openday.slots', { count: jogos.length }), t('openday.signed', { count: inscritos })].join(' · ')}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {jogos.map((g) => {
            const n = slotPeople(g)
            return (
              <button key={g.id} type="button" onClick={() => onOpen(g)}
                aria-label={`${formatTime(g.date, i18n.language, { hour: '2-digit', minute: '2-digit' })} · ${n}/${g.max_players || 4}`}
                className="min-h-[38px] rounded-ctrl border-[1.5px] px-3 font-mono text-[14px] font-extrabold"
                style={n > 0 ? { background: cor.strong, borderColor: cor.strong, color: '#fff' } : { borderColor: cor.line || '#F2BFA8', color: '#111' }}>
                {formatTime(g.date, i18n.language, { hour: '2-digit', minute: '2-digit' })}
              </button>
            )
          })}
        </div>
      </div>
      {onEdit && (
        <button type="button" onClick={onEdit}
          className="absolute right-3 top-3 min-h-[40px] rounded-ctrl border border-line bg-white px-3.5 text-sm font-extrabold text-ink-900">
          {t('gerirclube.edit_action')}
        </button>
      )}
    </div>
  )
}
