import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { BackBar } from '../components/ui'
import XpShield from '../components/XpShield'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { XP_TIERS, tierFromXp, preTierProgress, formatXp } from '../lib/xp'
import { KIND_COLORS } from '../lib/kindColors'
import { groupXpByGame } from '../lib/xpMonth'

/* R15 · A página do XP de atividade (design-handoff/2026-10-13-redesign/
   R15-pagina-do-xp.md). Entra-se pelo cartão «XP DE ATIVIDADE» do Perfil.
   Os níveis e os valores são os da app (lib/xp.js); o mês vem de xp_events,
   que cada pessoa lê só para si (RLS), junto por jogo. */

// Do mais baixo para o mais alto, como na lista do desenho.
const LEVELS = [...XP_TIERS].reverse()
const EARN = [['20 XP', 'xp_page.earn_mix'], ['5 XP', 'xp_page.earn_game'], ['+30 XP', 'xp_page.earn_win'], ['10 XP', 'xp_page.earn_friendly']]

/* «Diamante · estás aqui» numa linha; quando não cabe (World Class), o
   «estás aqui» desce para baixo do nome, mais pequeno, a verde. Nunca com
   reticências (UX, 19 out). */
function HereLabel({ name }) {
  const { t } = useTranslation()
  const boxRef = useRef(null)
  const lineRef = useRef(null)
  const [stacked, setStacked] = useState(false)
  useLayoutEffect(() => {
    const box = boxRef.current
    const line = lineRef.current
    if (!box || !line) return
    // A frase inteira mede-se sempre, escondida; se for mais larga do que o espaço, desce.
    const check = () => setStacked(line.offsetWidth > box.clientWidth)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(box)
    return () => ro.disconnect()
  }, [name])
  const full = t('xp_page.you_are_here', { name })
  return (
    <span ref={boxRef} className="relative min-w-0 flex-1">
      <span ref={lineRef} aria-hidden="true" className="invisible absolute left-0 top-0 whitespace-nowrap text-[15px] font-extrabold">{full}</span>
      {stacked ? (
        <>
          <span className="block text-[15px] font-extrabold leading-tight text-ink-900 [overflow-wrap:anywhere]">{name}</span>
          <span className="block text-[12.5px] font-bold leading-tight text-[#3F6212]">{t('xp_page.here_short')}</span>
        </>
      ) : (
        <span className="block whitespace-nowrap text-[15px] font-extrabold text-ink-900">{full}</span>
      )}
    </span>
  )
}

export default function ProfileXp() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [month, setMonth] = useState(null) // null = a carregar
  const xp = profile?.xp ?? 0
  const tier = tierFromXp(xp)
  const progress = tier ?? preTierProgress(xp)
  const next = XP_TIERS.find((x) => x.min === progress.nextMin) || null
  const loc = i18n.language?.startsWith('en') ? 'en-GB' : 'pt-PT'

  useEffect(() => {
    if (!profile?.id) return
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    supabase.from('xp_events')
      .select('kind, amount, occurred_at, source_game_id, source_private_match_id, games(title)')
      .eq('user_id', profile.id).gte('occurred_at', start).order('occurred_at', { ascending: false })
      .then(({ data, error }) => setMonth(error ? [] : groupXpByGame(data || [])))
  }, [profile?.id])

  const monthTotal = (month || []).reduce((s, g) => s + g.amount, 0)
  const kicker = 'mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted'
  const lineLabel = (g) => {
    const name = g.friendly ? t('xp_page.friendly') : (g.title || t('xp_page.mix'))
    const what = g.won ? t('xp_page.you_won') : !g.friendly && g.games ? t('xp_page.games', { count: g.games }) : null
    return what ? `${name} · ${what}` : name
  }

  return (
    <div className="space-y-5 pb-6">
      {/* A barra comum das páginas sem capa (BackBar, vidro do Bugs): presa ao
          descer, com o nome ao centro depois de o título sair (15 out). */}
      <BackBar onBack={() => navigate('/perfil')} title={t('xp_page.title')} />
      <h1 className="text-[28px] font-extrabold leading-tight text-ink-900">{t('xp_page.title')}</h1>

      {/* O cartão preto: o nível, o XP e a barra até ao seguinte. */}
      <div className="rounded-[22px] bg-ink-900 px-5 pt-6 pb-5 text-center text-white">
        {/* O escudo do nível (16 out); no nível 0, o do Iniciado a cinzento. */}
        {/* Sem sombra: no preto não se via e desenhava um quadrado à volta da imagem (UX, 19 out). */}
        <XpShield tierKey={tier ? tier.key : 'iniciado'} size={104} dim={!tier} className="mx-auto block" />
        <p className="mt-3 font-display text-[26px] font-black leading-tight">
          {tier ? t('xp_page.level', { name: t(tier.labelKey), level: tier.level }) : t('profile.xp_no_shield')}
        </p>
        <p className="mt-1 text-[13px] text-white/60">{t('xp_page.what', { xp: formatXp(xp) })}</p>
        {next ? (
          <>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-lime-400" style={{ width: `${progress.progressPct}%` }} />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-white/70">
              <span>{formatXp(xp)}</span>
              <span className="flex items-center gap-1.5"><XpShield tierKey={next.key} size={18} />{t(next.labelKey)} · {formatXp(next.min)}</span>
            </div>
          </>
        ) : (
          <p className="mt-4 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-lime-400">{t('xp_page.top')}</p>
        )}
      </div>

      <section>
        <p className={kicker}>{t('xp_page.how_title')}</p>
        <div className="grid grid-cols-2 gap-2.5">
          {EARN.map(([v, k]) => (
            <div key={k} className="rounded-card bg-white p-3.5 shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
              <p className="font-display text-[22px] font-black leading-none text-ink-900">{v}</p>
              <p className="mt-1.5 text-[13px] leading-snug text-muted">{t(k)}</p>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[13px] text-muted">{t('xp_page.only_up')}</p>
      </section>

      <section>
        <p className={kicker}>{t('xp_page.levels_title')}</p>
        <ol className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
          {LEVELS.map((l) => {
            const here = tier?.key === l.key
            const passed = xp >= l.min && !here
            const future = xp < l.min
            return (
              <li key={l.key} className={`flex items-center gap-3 border-b border-line px-4 py-2 last:border-b-0 ${here ? 'bg-[#F4F8DC]' : ''}`}>
                <span className="w-5 shrink-0 font-mono text-[13px] font-medium text-muted">
                  {passed ? <Check size={15} className="text-[#4D7C0F]" strokeWidth={2.5} /> : l.level}
                </span>
                {/* Escudos (16 out): a cores os que já tens; os outros a cinzento e meio apagados. */}
                <XpShield tierKey={l.key} size={32} dim={future} />
                {here ? <HereLabel name={t(l.labelKey)} /> : (
                  <span className={`min-w-0 flex-1 truncate text-[15px] font-extrabold ${future ? 'text-[#6B7280]' : 'text-ink-900'}`}>{t(l.labelKey)}</span>
                )}
                <span className={`shrink-0 font-mono text-[13px] font-medium tabular-nums ${future ? 'text-[#6B7280]' : 'text-ink-900'}`}>{formatXp(l.min)} XP</span>
              </li>
            )
          })}
        </ol>
      </section>

      {month && (
        <section>
          <p className={kicker}>{monthTotal ? t('xp_page.month_title', { xp: formatXp(monthTotal) }) : t('xp_page.month_title_empty')}</p>
          {month.length === 0 ? (
            <p className="rounded-card bg-white px-4 py-3.5 text-sm text-muted shadow-[0_1px_2px_rgba(17,17,17,0.06)]">{t('xp_page.month_empty')}</p>
          ) : (
            <ul className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
              {month.map((g) => (
                <li key={g.key} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: (g.friendly ? KIND_COLORS.friends : KIND_COLORS.mix)?.strong }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-extrabold text-ink-900">{lineLabel(g)}</span>
                    <span className="block text-[12.5px] text-muted">{`${new Date(g.at).getDate()} ${new Date(g.at).toLocaleDateString(loc, { month: 'short' }).replace('.', '')}`}</span>
                  </span>
                  <span className="shrink-0 font-display text-[15px] font-black text-[#4D7C0F]">+{formatXp(g.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <button type="button" onClick={() => navigate('/rankings', { state: { tab: 'assiduidade' } })}
        className="w-full rounded-ctrl border-[1.5px] border-ink-200 bg-white py-3.5 text-[15px] font-extrabold text-ink-900">
        {t('xp_page.see_ranking')}
      </button>
    </div>
  )
}
