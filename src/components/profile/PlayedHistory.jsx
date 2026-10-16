import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, CalendarDays, Shuffle, Trophy, Users, CircleDot } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { errorKind } from '../../lib/errors'
import { KIND_COLORS } from '../../lib/kindColors'
import { FRAME_TITLE_KEY } from '../../lib/frames'
import { medalUrl } from '../../lib/achievementMedals'
import { FilterBar, FilterPill, EmptyState } from '../ui'
import { Realce } from '../SearchField'
import { semAcentos } from '../../lib/semAcentos'
import { Crown } from '../rankings/RankPodium'

/* Perfil › Jogos «com vida» (#636, design-handoff/2026-10-12-perfil-jogos-
   com-vida, aprovado pelo Francisco a 12 out, com o acerto de 13 out: sem
   bonecos, a faixa na cor forte do tipo, o corpo branco, sem borda preta no
   1.º e a coroa a 45°). Tudo o que a pessoa jogou, por mês, do mais recente
   para trás; ao descer, carrega o resto. Os números são os do «Já jogados» e
   dos Rankings: vêm todos das funções do Dev 3 (get_my_played_history,
   get_my_played_months e get_my_played_kinds). */

const PAGE = 30
const KINDS = ['mix', 'open', 'tournament', 'friends']
const KIND_ICON = { mix: Shuffle, open: CircleDot, tournament: Trophy, friends: Users }
const KIND_LABEL = { mix: 'agenda.kind_mix', open: 'agenda.kind_open', tournament: 'agenda.kind_tournament', friends: 'played.kind_friends' }
const KIND_FILTER = { mix: 'agenda.filter_kind_mix', open: 'played.filter_open', tournament: 'agenda.filter_kind_tournament', friends: 'agenda.filter_kind_friends_short' }
const PLACE_BOX = {
  1: 'bg-gradient-to-br from-[#F6D365] to-[#E2A93B] text-ink-900',
  2: 'bg-gradient-to-br from-[#EEF0F3] to-[#C5CAD3] text-ink-900',
  3: 'bg-gradient-to-br from-[#E9B48A] to-[#C2794A] text-ink-900',
}
const FRAME_BY_PLACE = { 1: 'ouro', 2: 'prata', 3: 'bronze' }

const monthKeyOf = (iso) => `${String(iso).slice(0, 7)}-01`
const lang2 = (l) => (l?.startsWith('en') ? 'en' : 'pt')
const monthLong = (key, lang) => {
  const d = new Date(`${key.slice(0, 7)}-01T12:00:00`)
  const s = d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'pt-PT', { month: 'long', year: 'numeric' }).replace(' de ', ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const dayShort = (iso, lang) => {
  const d = new Date(iso)
  const loc = lang === 'en' ? 'en-GB' : 'pt-PT'
  // «seg 12 out»: três letras do dia, como no protótipo.
  return `${d.toLocaleDateString(loc, { weekday: 'short' }).replace('.', '').slice(0, 3)} ${d.getDate()} ${d.toLocaleDateString(loc, { month: 'short' }).replace('.', '')}`
}
const durationText = (min) => {
  if (!min) return null
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m} min`
}

/** Os dados da lista, com os filtros. history null = as funções ainda não
 *  existem (PGRST202): o Perfil mostra a lista antiga. */
export function usePlayedHistory({ query, kind, enabled = true }) {
  const month = null // o «📅» salta para o mês, não filtra (UX, 14 out)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState('loading') // loading | ready | missing | error
  const [hasMore, setHasMore] = useState(false)
  const [months, setMonths] = useState([])
  const [kinds, setKinds] = useState([])
  const seq = useRef(0)
  const q = query.trim() || null

  useEffect(() => {
    // Só se pede quando se abre «Jogos»: o Perfil abre sem estas chamadas.
    if (!enabled) return
    const my = ++seq.current
    setState('loading')
    const args = { p_kind: kind, p_query: q, p_month: month }
    // Uma chamada de cada vez (PO, 14 out): primeiro a lista, que é o que se
    // vê; os resumos dos meses e as contagens dos tipos vêm depois, sem
    // prender o ecrã nem disputar a base com a lista.
    supabase.rpc('get_my_played_history', { ...args, p_limit: PAGE }).then(async (h) => {
      if (my !== seq.current) return
      if (h.error) {
        if (errorKind(h.error) === 'not_ready') { setState('missing'); return }
        console.error('Error loading played history:', h.error)
        setState('error')
        return
      }
      const list = h.data?.rows || []
      setRows(list)
      setTotal(h.data?.total ?? list.length)
      setHasMore(list.length >= PAGE)
      setState('ready')
      const m = await supabase.rpc('get_my_played_months', { p_kind: kind, p_query: q })
      if (my !== seq.current) return
      setMonths(m.error ? [] : (m.data || []))
      const k = await supabase.rpc('get_my_played_kinds', { p_query: q })
      if (my !== seq.current) return
      setKinds(k.error ? [] : (k.data || []))
    })
  }, [kind, q, month, enabled])

  const loadMore = useCallback(() => {
    if (!hasMore || state !== 'ready' || !rows.length) return
    const my = seq.current
    const before = rows[rows.length - 1].starts_at
    setHasMore(false)
    supabase.rpc('get_my_played_history', { p_kind: kind, p_query: q, p_month: month, p_before: before, p_limit: PAGE })
      .then(({ data, error }) => {
        if (my !== seq.current || error) return
        const more = data?.rows || []
        setRows((r) => [...r, ...more])
        setHasMore(more.length >= PAGE)
      })
  }, [hasMore, state, rows, kind, q, month])

  /** Carrega até o mês `key` estar na lista (para o salto). */
  const loadUntil = useCallback(async (key) => {
    let list = rows
    let more = hasMore
    const my = seq.current
    while (more && !list.some((r) => monthKeyOf(r.starts_at) === key) && list.length) {
      const { data, error } = await supabase.rpc('get_my_played_history', { p_kind: kind, p_query: q, p_before: list[list.length - 1].starts_at, p_limit: PAGE })
      if (my !== seq.current || error) return
      const page = data?.rows || []
      list = [...list, ...page]
      more = page.length >= PAGE
    }
    setRows(list)
    setHasMore(more)
  }, [rows, hasMore, kind, q])

  return { rows, total, state, hasMore, loadMore, loadUntil, months, kinds }
}

/** Todo o histórico, sem filtros (todas as páginas) — para os totais do
 *  cartão do Perfil. null = as funções ainda não existem. */
export function useAllPlayed(enabled) {
  const [rows, setRows] = useState(undefined)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    ;(async () => {
      let list = []
      for (let i = 0; i < 20; i++) {
        const before = list.length ? list[list.length - 1].starts_at : null
        const { data, error } = await supabase.rpc('get_my_played_history', { p_before: before, p_limit: 100 })
        if (!alive) return
        if (error) {
          if (errorKind(error) !== 'not_ready') console.error('Error loading played totals:', error)
          setRows(list.length ? list : null)
          return
        }
        const page = data?.rows || []
        list = [...list, ...page]
        if (page.length < 100) break
      }
      setRows(list)
    })()
    return () => { alive = false }
  }, [enabled])
  return rows
}

/** Jogos e vitórias de todos os tipos (rondas, nos amigos); sem os
 *  amigáveis ainda por enviar. */
export function playedTotals(rows) {
  if (!Array.isArray(rows)) return null
  let games = 0
  let wins = 0
  for (const r of rows) {
    if (r.kind === 'friends' && r.status === 'pending') continue
    games += Number(r.games) || 0
    wins += Number(r.wins) || 0
  }
  return { games, wins }
}

/** A barra presa em cima (R4): 🔍 · «📅 Outubro 2026 ⌄» | Tudo · Mixes · … */
export function PlayedBar({ query, setQuery, kind, setKind, visibleMonth, onOpenMonths, kinds }) {
  const { t, i18n } = useTranslation()
  const lang = lang2(i18n.language)
  const all = kinds.reduce((n, k) => n + k.count, 0)
  const present = KINDS.filter((k) => kinds.some((x) => x.kind === k))
  return (
    <FilterBar search={{ value: query, onChange: setQuery, placeholder: t('played.search_placeholder') }}
      lead={(
        <FilterPill chevron onClick={onOpenMonths}>
          <CalendarDays size={15} className="text-[#075985]" />
          {visibleMonth ? monthLong(visibleMonth, lang) : t('played.month_any')}
        </FilterPill>
      )}>
      <FilterPill on={!kind} count={all || null} onClick={() => setKind(null)}>{t('agenda.kind_everything')}</FilterPill>
      {present.map((k) => (
        <FilterPill key={k} on={kind === k} dot={KIND_COLORS[k].strong} count={kinds.find((x) => x.kind === k)?.count}
          onClick={() => setKind(kind === k ? null : k)}>
          {t(KIND_FILTER[k])}
        </FilterPill>
      ))}
    </FilterBar>
  )
}

/** A folha «Ir para um mês» (SPEC, ponto 2): os 12 meses de cada ano em
 *  grelha de 3, com «N jogos»; o mês à vista a preto; os meses sem jogos
 *  apagados, tracejados, sem dar para tocar; puxador em cima, sem «✕». */
export function MonthsSheet({ months, month, onPick, onClose }) {
  const { t, i18n } = useTranslation()
  const lang = lang2(i18n.language)
  const byMonth = new Map(months.map((m) => [String(m.month).slice(0, 7), m]))
  const now = new Date()
  const firstYear = months.length ? Number(String(months[months.length - 1].month).slice(0, 4)) : now.getFullYear()
  const years = []
  for (let y = now.getFullYear(); y >= firstYear; y -= 1) years.push(y)
  const short = (k) => new Date(`${k}-01T12:00:00`).toLocaleDateString(lang === 'en' ? 'en-GB' : 'pt-PT', { month: 'short' }).replace('.', '')
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('played.months_title')}
        className="max-h-[85%] w-full max-w-md overflow-y-auto rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-lift sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-ink-200" />
        <p className="font-display text-[22px] font-extrabold leading-tight text-ink-900">{t('played.months_title')}</p>
        {years.map((y) => (
          <div key={y} className="mt-4">
            <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-muted">{y}</p>
            <div className="grid grid-cols-3 gap-2">
              {/* O ano em curso só vai até ao mês de hoje (UX, 14 out). */}
              {Array.from({ length: y === now.getFullYear() ? now.getMonth() + 1 : 12 }, (_, i) => `${y}-${String((y === now.getFullYear() ? now.getMonth() + 1 : 12) - i).padStart(2, '0')}`).map((k) => {
                const m = byMonth.get(k)
                const on = month && month.slice(0, 7) === k
                return (
                  <button key={k} type="button" disabled={!m} onClick={() => onPick(`${k}-01`)}
                    className={`rounded-ctrl px-2 py-2.5 text-center ${on ? 'bg-ink-900 text-white' : m ? 'border border-line bg-white text-ink-900' : 'cursor-default border border-dashed border-line text-ink-200'}`}>
                    <span className="block text-sm font-extrabold">{short(k)}</span>
                    <span className={`block text-[11px] ${on ? 'text-white/75' : m ? 'text-muted' : 'text-ink-200'}`}>{m ? t('played.games_count', { count: m.games }) : '—'}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}

function PointsCol({ delta }) {
  const { t } = useTranslation()
  if (delta == null) return null
  const n = Math.round(Number(delta))
  const text = n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0'
  return (
    <div className="shrink-0 text-right">
      <p className={`font-display text-xl font-extrabold leading-none tabular-nums ${n > 0 ? 'text-[#4D7C0F]' : 'text-muted'}`}>{text}</p>
      <p className="mt-1 text-[10px] text-muted">{t('played.points')}</p>
    </div>
  )
}

function PlayedCard({ r, query = '' }) {
  const { t, i18n } = useTranslation()
  const lang = lang2(i18n.language)
  const color = KIND_COLORS[r.kind] || KIND_COLORS.mix
  const Icon = KIND_ICON[r.kind] || Shuffle
  const friends = r.kind === 'friends'
  const pending = friends && r.status === 'pending'
  const to = friends ? (r.session_id ? `/jogos-privados/sessao/${r.session_id}` : '/jogos-privados')
    : r.kind === 'tournament' ? `/torneio/${r.event_id}` : `/jogo/${r.event_id}`
  const kindLabel = `${t(KIND_LABEL[r.kind] || 'agenda.kind_mix')}${r.category_code ? ` · ${r.category_code}` : ''}`

  // O quadrado: o lugar (ouro, prata, bronze ou branco), ou o resultado nos amigos.
  const myScore = r.my_team === 'b' ? r.score_b : r.score_a
  const theirScore = r.my_team === 'b' ? r.score_a : r.score_b
  const draw = friends && myScore != null && myScore === theirScore
  const square = friends ? (
    <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] bg-ink-50 font-display text-[22px] font-extrabold tabular-nums ${draw || pending ? 'text-muted' : 'text-ink-900'}`}>
      {myScore ?? r.rounds_won ?? 0}–{theirScore ?? Math.max(0, (r.rounds_played || 0) - (r.rounds_won || 0))}
    </div>
  ) : (
    <div className={`relative flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-[18px] ${PLACE_BOX[r.place] || 'bg-ink-50 text-ink-900'}`}>
      {r.place === 1 && <Crown ring={56} />}
      <span className="font-display text-[22px] font-extrabold leading-none">{r.place ? `${r.place}.º` : '—'}</span>
      {r.total ? <span className="mt-0.5 text-[10px] font-bold opacity-70">{t('played.of_total', { total: r.total })}</span> : null}
    </div>
  )

  // O texto ao lado.
  let title = r.title
  let accent = null
  let lines = []
  if (friends) {
    title = pending ? t('played.to_close') : draw ? t('played.draw') : r.won ? t('played.you_won') : t('played.you_lost')
    // «Rui C.» nunca parte entre o nome e a inicial (UX, 14 out).
    const nb = (n) => String(n || '').replace(/ (?=\S+$)/, '\u00A0')
    const mine = ((r.my_team === 'b' ? r.team_b : r.team_a) || []).map(nb)
    const others = ((r.my_team === 'b' ? r.team_a : r.team_b) || []).map(nb)
    if (pending) accent = { text: t('played.missing_result'), className: 'text-danger' }
    else if (mine.length || others.length) {
      lines.push(t('played.teams', { partner: (r.partner_name && nb(r.partner_name)) || mine[1] || '—', others: others.join(` ${t('played.and')} `) }))
    }
    const extra = [durationText(r.duration_minutes) && `⏱ ${durationText(r.duration_minutes)}`, r.rounds_played ? t('played.rounds', { count: r.rounds_played }) : null].filter(Boolean).join(' · ')
    if (extra && !pending) lines.push(extra)
  } else {
    if (FRAME_BY_PLACE[r.place]) {
      const phase = r.kind === 'tournament' && r.phase ? ` · ${t(`played.phase_${r.phase}`)}` : ''
      accent = { text: `${t(FRAME_TITLE_KEY[FRAME_BY_PLACE[r.place]])}${phase}`, style: { color: color.strong } }
    }
    const who = r.kind === 'tournament' && r.partner_name ? t('played.with', { name: r.partner_name }) : r.org_name
    const wins = r.games ? t('played.wins_of', { wins: r.wins || 0, games: r.games }) : null
    lines.push([who, wins].filter(Boolean).join(' · '))
  }
  if (friends && r.location && !pending) lines.push(r.location)
  lines = lines.filter(Boolean)

  // A parte encontrada a lima-claro (SPEC da pesquisa, 14 out). Os nomes
  // levam espaço que não parte («Rui C.»): a pesquisa «rui c» também o acha.
  const hit = (text) => (semAcentos(text).includes(semAcentos(query).trim()) ? query : query.replace(/ /g, ' '))

  // Em baixo: conquistas, kudos, o estado nos amigos e «↗».
  const pills = [
    ...(r.achievements || []).map((a) => (
      <span key={a.key} className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 py-1 pl-1 pr-2.5 text-[12px] font-extrabold text-ink-900">
        {medalUrl(a.key) ? <img src={medalUrl(a.key)} alt="" className="h-6 w-6" loading="lazy" /> : null}
        {t(`achievements.${a.key}_name`)}
      </span>
    )),
    r.kudos > 0 && (
      <span key="kudos" className="inline-flex items-center rounded-full bg-ink-50 px-2.5 py-1 text-[12px] font-extrabold text-ink-900">
        👏 {t('played.kudos', { count: r.kudos })}
      </span>
    ),
  ].filter(Boolean)
  const status = friends && !pending ? (r.ranking_state === 'not_ranked' ? t('played.friendly') : `✓ ${t('played.counted')}`) : null
  const cheer = !friends && !pills.length && !FRAME_BY_PLACE[r.place] ? t('played.next_time') : null

  return (
    <article className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
      <div className="flex items-center justify-between gap-2 px-3.5 py-1.5 text-[12px] font-extrabold text-white" style={{ background: color.strong }}>
        <span className="flex min-w-0 items-center gap-1.5 truncate"><Icon size={13} className="shrink-0" /> {kindLabel}</span>
        <span className="shrink-0 font-bold">{dayShort(r.starts_at, lang)}</span>
      </div>
      <Link to={to} className="flex items-center gap-3 px-3.5 pb-3 pt-4">
        {square}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[17px] font-extrabold leading-tight text-ink-900">{friends ? title : <Realce text={title || ''} query={hit(title)} />}</p>
          {accent && <p className={`mt-0.5 truncate text-[13px] font-extrabold ${accent.className || ''}`} style={accent.style}>{accent.text}</p>}
          {lines.map((l) => <p key={l} className="mt-0.5 text-[12.5px] leading-snug text-muted"><Realce text={l} query={hit(l)} /></p>)}
        </div>
        {!pending && <PointsCol delta={r.rating_delta} />}
      </Link>
      <div className="flex items-center gap-2 border-t border-line px-3.5 py-2.5">
        {pending ? (
          <>
            <span className="flex-1 text-[12.5px] text-muted">{t('played.points_when_sent')}</span>
            <Link to={to} className="shrink-0 text-[13px] font-extrabold text-ink-900">{t('played.send')} ›</Link>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {pills}
              {status && <span className="text-[12.5px] text-muted">{status}</span>}
              {cheer && <span className="text-[12.5px] text-muted">{cheer}</span>}
            </div>
            <Link to={to} aria-label={t('played.share_aria')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-900">
              <ArrowUpRight size={15} />
            </Link>
          </>
        )}
      </div>
    </article>
  )
}

/** A lista: por mês, com o resumo do mês, e ao descer carrega mais. */
export default function PlayedHistory({ data, query, kind, onVisibleMonth, jumpTo, onJumped }) {
  const month = null
  const { t, i18n } = useTranslation()
  const lang = lang2(i18n.language)
  const { rows, total, state, hasMore, loadMore, months } = data
  const sentinel = useRef(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore) return undefined
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore() }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loadMore])

  const groups = useMemo(() => {
    const out = []
    for (const r of rows) {
      const k = monthKeyOf(r.starts_at)
      if (!out.length || out[out.length - 1].key !== k) out.push({ key: k, rows: [] })
      out[out.length - 1].rows.push(r)
    }
    return out
  }, [rows])
  // O mês à vista: o último cujo título já passou por baixo da barra presa.
  useEffect(() => {
    if (!onVisibleMonth) return undefined
    // O «main» pode ser trocado pela página; ouve-se o scroll no documento.
    const update = () => {
      const main = document.querySelector('main')
      if (!main) return
      const bar = document.querySelector('main .sticky.top-0')
      // A barra presa mede sempre a sua altura a contar do topo do «main».
      const line = main.getBoundingClientRect().top + (bar ? bar.offsetHeight : 120) + 8
      // No fundo da lista os últimos meses já não sobem até à barra: conta
      // o último cujo título está à vista.
      const atEnd = main.scrollTop + main.clientHeight >= main.scrollHeight - 4
      const limit = atEnd ? main.getBoundingClientRect().bottom - 40 : line
      let cur = groups[0]?.key || null
      for (const g of groups) {
        const el = document.getElementById(`played-${g.key.slice(0, 7)}`)
        if (el && el.getBoundingClientRect().top <= limit) cur = g.key
      }
      onVisibleMonth(cur)
    }
    update()
    document.addEventListener('scroll', update, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', update, { capture: true })
  }, [groups, onVisibleMonth])
  // O salto: carrega até ao mês e põe o título dele logo por baixo da barra.
  useEffect(() => {
    if (!jumpTo) return
    const el = document.getElementById(`played-${jumpTo.slice(0, 7)}`)
    if (!el) { data.loadUntil(jumpTo); return }
    const main = document.querySelector('main')
    const bar = document.querySelector('main .sticky.top-0')
    if (main) main.scrollTop += el.getBoundingClientRect().top - main.getBoundingClientRect().top - (bar ? bar.offsetHeight : 0) - 8
    onJumped?.()
  }, [jumpTo, groups, data, onJumped])
  const summary = (key) => months.find((m) => String(m.month).slice(0, 7) === key.slice(0, 7))

  if (state === 'loading') return null
  if (state === 'error') return <EmptyState pose="triste" title={t('ui.load_error_title')} />
  const q = query.trim()
  if (!rows.length) {
    return q
      ? <EmptyState title={t('comunidade.nothing_found_title')} subtitle={t('comunidade.try_another_name')} />
      : <EmptyState title={t('played.empty_title')} subtitle={t('played.empty_body')} />
  }
  const oldest = rows[rows.length - 1]?.starts_at
  return (
    <div className="space-y-3">
      {(q || kind || month) && (
        <p className="text-[13px] text-muted">
          {t('played.found', {
            count: total,
            what: kind ? t(KIND_FILTER[kind]).toLowerCase() : t('played.games_word', { count: total }),
          })}
          {q ? ` ${t('played.with_query', { q })}` : ''}
          {oldest && !month ? ` · ${t('played.since', { month: new Date(oldest).toLocaleDateString(lang === 'en' ? 'en-GB' : 'pt-PT', { month: 'long' }) })}` : ''}
        </p>
      )}
      {groups.map((g) => {
        const s = summary(g.key)
        return (
          <section key={g.key} id={`played-${g.key.slice(0, 7)}`} className="space-y-3">
            <div className="pt-1">
              <p className="font-mono text-[12px] font-bold uppercase tracking-widest text-muted">{monthLong(g.key, lang)}</p>
              {s && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    [s.games, t('played.sum_games', { count: s.games })],
                    s.titles ? [s.titles, t('played.sum_titles', { count: s.titles })] : null,
                    [s.points > 0 ? `+${s.points}` : String(s.points), t('played.sum_points'), s.points > 0 ? 'text-[#4D7C0F]' : 'text-muted'],
                    s.kudos ? [s.kudos, t('played.sum_kudos', { count: s.kudos })] : null,
                  ].filter(Boolean).map(([n, label, cls]) => (
                    <span key={label} className="rounded-full bg-white px-2.5 py-1 text-[12.5px] text-ink-700 shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
                      <b className={`font-extrabold ${cls || 'text-ink-900'}`}>{n}</b> {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {g.rows.map((r) => <PlayedCard key={`${r.kind}:${r.event_id}:${r.category_code || ''}`} r={r} query={query} />)}
          </section>
        )
      })}
      {hasMore && <div ref={sentinel} className="h-10" />}
    </div>
  )
}
