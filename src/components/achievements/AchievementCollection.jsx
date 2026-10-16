import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { medalUrl } from '../../lib/achievementMedals'
import { RARITY_META } from '../../lib/achievements'
import { supabase } from '../../lib/supabase'
import AchievementViewer from './AchievementViewer'
import './achievementsFx.css'

/* A coleção do «Ver todos» no Perfil (design-handoff/2026-10-12-conquistas-
   animadas). Em cima, a contagem e a barra que enche ao abrir; depois
   «Ganhas há pouco» (as 6 últimas, cartões altos e escuros, as 2 mais
   recentes com «NOVA») e a grelha clara de 4 por linha, agrupada por
   raridade, da mais rara para a comum. Tocar abre o cartão no meio do ecrã.
   Este componente é lazy: as animações e as imagens só se carregam quando
   se abre a coleção. */

const RARITY_ORDER = ['lendario', 'epico', 'raro', 'comum']
const RECENT = 6

const rarityOf = (r) => (RARITY_META[r] ? r : 'comum')

// owner: { id, name, avatar_url } quando a coleção é de outra pessoa (o perfil
// dela): a folha diz «O Rui ganhou…» e a partilha leva-a a ela.
export default function AchievementCollection({ catalog, mine, owner = null }) {
  const { t } = useTranslation()
  const [filled, setFilled] = useState(false)
  const [open, setOpen] = useState(null) // { items, start, locked }
  // A «% têm» das que ainda não tenho (get_achievement_rarity, migração de
  // 11 out). Fail-soft: sem a função, o cartão por ganhar fica sem ela.
  const [pctByKey, setPctByKey] = useState(() => new Map())
  useEffect(() => {
    let alive = true
    supabase.rpc('get_achievement_rarity').then(({ data, error }) => {
      if (!alive || error || !data) return
      setPctByKey(new Map(data.map((r) => [r.achievement_key, r.rarity_pct])))
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => setFilled(true), 120)
    return () => clearTimeout(id)
  }, [])

  const { earned, recent, groups } = useMemo(() => {
    const byKey = new Map(mine.map((m) => [m.achievement_key, m]))
    const sortOf = new Map(catalog.map((c) => [c.key, c.sort]))
    // As ganhas, da mais recente para a mais antiga — é a ordem do «Ganhas há
    // pouco» e a de deslizar no cartão.
    const earnedList = mine
      .filter((m) => sortOf.has(m.achievement_key))
      .slice()
      .sort((x, y) => String(y.awarded_at || '').localeCompare(String(x.awarded_at || '')))
      .map((m) => ({ key: m.achievement_key, rarity: rarityOf(m.rarity), pct: m.rarity_pct ?? pctByKey.get(m.achievement_key), at: m.awarded_at }))
    const grouped = RARITY_ORDER.map((r) => {
      const list = catalog
        .filter((c) => rarityOf(c.rarity) === r)
        .sort((x, y) => (byKey.has(y.key) ? 1 : 0) - (byKey.has(x.key) ? 1 : 0) || x.sort - y.sort)
        .map((c) => ({ key: c.key, rarity: r, earned: byKey.has(c.key), pct: byKey.get(c.key)?.rarity_pct ?? pctByKey.get(c.key) }))
      return { rarity: r, list, got: list.filter((c) => c.earned).length }
    }).filter((g) => g.list.length > 0)
    return { earned: earnedList, recent: earnedList.slice(0, RECENT), groups: grouped }
  }, [catalog, mine, pctByKey])

  const openEarned = (key) => {
    const start = earned.findIndex((e) => e.key === key)
    if (start >= 0) setOpen({ items: earned, start, locked: false })
  }

  const pct = catalog.length ? earned.length / catalog.length : 0
  let k = 0

  return (
    <div>
      <div className="flex items-center justify-end mb-1.5">
        <span className="text-[13px] font-extrabold text-muted tabular-nums">
          {t('achievements.fx_count', { earned: earned.length, total: catalog.length })}
        </span>
      </div>
      <div className="achv-bar"><i style={{ transform: `scaleX(${filled ? pct : 0})` }} /></div>

      {recent.length > 0 && (
        <>
          <p className="achv-lab">{t('achievements.fx_recent')}</p>
          <div className="achv-rail">
            {recent.map((a, i) => (
              <button
                key={a.key}
                type="button"
                onClick={() => openEarned(a.key)}
                className={`achv-tc achv-r-${a.rarity}`}
                style={{ animationDelay: `${i * 0.09}s`, '--d': `${1 + i * 0.7}s` }}
              >
                {i < 2 && <span className="achv-new">{t('achievements.fx_new')}</span>}
                <span className="achv-tc-in">
                  {medalUrl(a.key) && <img src={medalUrl(a.key)} alt="" loading="lazy" decoding="async" />}
                  <b>{t(`achievements.${a.key}_name`)}</b>
                  <em>{t(RARITY_META[a.rarity].labelKey)}</em>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {groups.map((g) => (
        <div key={g.rarity}>
          <p className={`achv-lab achv-r-${g.rarity}`}>
            {t('achievements.fx_group', { rarity: t(RARITY_META[g.rarity].labelKey), earned: g.got, total: g.list.length })}
          </p>
          <div className="achv-grid">
            {g.list.map((c) => {
              const medal = medalUrl(c.key)
              const name = t(`achievements.${c.key}_name`)
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => (c.earned ? openEarned(c.key) : setOpen({ items: [c], start: 0, locked: true }))}
                  className={`achv-sc achv-r-${c.rarity}${c.earned ? '' : ' achv-lock'}`}
                  style={{ animationDelay: `${0.4 + Math.min(k++, 30) * 0.035}s` }}
                >
                  <span className="achv-sc-in">
                    <span className="achv-sc-pad">
                      {medal ? <img src={medal} alt="" loading="lazy" decoding="async" /> : null}
                      {!c.earned && (
                        <span className="achv-lockdot"><Lock size={10} className="text-lime-400" /></span>
                      )}
                    </span>
                    <span className="achv-sc-name">{name}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {open && (
        <AchievementViewer items={open.items} start={open.start} locked={open.locked} owner={owner} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}
