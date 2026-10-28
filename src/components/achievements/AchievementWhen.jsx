// O quando e com quem, por baixo do cartão aberto de uma conquista ganha
// (design-handoff/2026-10-21-conquistas-quando-e-quebra-enguico, SPEC-UX).
// Centrado, uma coisa por linha: o dia (branco, negrito), o evento (branco a
// 66 %, sublinhado fino, abre a página), «com <parceiro>» e, só na Quebra
// Enguiço, «contra <A> e <B>». Os nomes nunca partem a meio. A privacidade
// vem da base (get_player_achievements_v2): o que não se pode ver chega null.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { achievementDay, achievementEventPath, achievementMonth, andWord } from '../../lib/achievements'

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || ''

function Person({ person, onNavigate }) {
  const { t } = useTranslation()
  const name = person?.name || t('achievements.when_removed')
  if (person?.id && person?.name && person.linkable !== false) {
    return (
      <Link to={`/jogador/${person.id}`} onClick={onNavigate}
        className="whitespace-nowrap underline decoration-white/40 underline-offset-2">{name}</Link>
    )
  }
  return <span className="whitespace-nowrap">{name}</span>
}

export default function AchievementWhen({ ctx, owner = null, onNavigate }) {
  const { t, i18n } = useTranslation()
  const other = owner ? { name: firstName(owner.name) } : null
  const day = achievementDay(ctx.context === 'antes' ? ctx.before : ctx.on, i18n.language)
  const dayKey = ctx.context === 'antes' ? 'when_before' : 'when_on'
  const path = achievementEventPath(ctx)
  // «Pódio do Mês» (UX, 22 out): o ranking do mês e a zona, sem logótipos.
  const monthRanking = ctx.eventKind === 'ranking_mes'
    ? t(ctx.eventTitle ? 'achievements.when_event_month_ranking' : 'achievements.when_event_month_ranking_nozone',
      { month: achievementMonth(ctx.on, i18n.language), zone: ctx.eventTitle })
    : null
  const eventLabel = monthRanking || ctx.eventTitle
    || (ctx.eventKind === 'amigos' ? t('achievements.when_event_friends')
      : ctx.eventKind === 'grupo' ? t('achievements.when_event_group') : null)
  const beaten = (ctx.beaten || []).slice(0, 2)
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      {day && (
        <p className="text-[13.5px] font-extrabold text-white">
          {t(`achievements.${dayKey}${other ? '_other' : ''}`, { date: day, name: other?.name })}
        </p>
      )}
      {eventLabel && (
        <p className="text-[12.5px] text-white/[.66]">
          {path ? (
            <Link to={path} onClick={onNavigate} className="underline decoration-white/30 underline-offset-2">{eventLabel}</Link>
          ) : eventLabel}
        </p>
      )}
      {ctx.partner && (
        <p className="text-[12.5px] text-white/[.66]">
          {t('achievements.when_with')} <Person person={ctx.partner} onNavigate={onNavigate} />
        </p>
      )}
      {beaten.length > 0 && (
        <p className="text-[12.5px] text-white/[.66]">
          {t('achievements.when_against')} <Person person={beaten[0]} onNavigate={onNavigate} />
          {beaten[1] && <> {andWord(t, i18n.language, beaten[1].name)} <Person person={beaten[1]} onNavigate={onNavigate} /></>}
        </p>
      )}
    </div>
  )
}
