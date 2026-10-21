import { useState, useEffect, useRef, useMemo } from 'react'
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Trophy, Award, HelpCircle, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { RatingBadge, EmptyState, Avatar, Select, PageHeader, Tabs, StickyTop, FilterBar } from '../components/ui'
import { formatRatingMaybeProvisional, isProvisional } from '../lib/elo'
import { tierFromXp, formatXp } from '../lib/xp'
import { winRatePct, buildMonthlyLeaderboard } from '../lib/statsLogic'
import { getPublicRankings } from '../lib/privateMatches'
import { getRankingHiddenIds, withoutHidden } from '../lib/rankingVisibility'
import { errorKind } from '../lib/errors'
import { useHeaderActions } from '../contexts/HeaderActionsContext'
import { applyScale, defaultScale, rankedCount, SCALES } from '../lib/rankingScales'
import MonthRanking from '../components/rankings/MonthRanking'
import MonthPodiumShare from '../components/rankings/MonthPodiumShare'
import RankPodium from '../components/rankings/RankPodium'
import RankingSkeleton from '../components/rankings/RankingSkeleton'
import { SkeletonGate } from '../components/Skeleton'
import { useFrames } from '../lib/frames'
import { Realce } from '../components/SearchField'

/* ─── Rankings (épico «Comunidade vs. Rankings», Trello #271/#275) ───────────
   Comparar jogadores — só jogadores. Desenho:
   https://claude.ai/artifact/LmwwNPxxnNRttG1RbHdDCt
   - Pesquisa de jogador em cima: filtra, mas cada um mantém a posição
     verdadeira, com "Ver na lista" para saltar para a altura dele.
   - Ranking · Assiduidade por cima da lista.
   - "Por clube" e "Mensal" deixaram de ser abas: são o âmbito (Global / um
     clube ou grupo) e o período (Sempre / um mês). O período por mês só
     existe dentro de um clube ou grupo — é aí que há histórico por mix.
   - Toda a gente aparece; quem não tem nível fica no fim, "Sem nível".
   - A tua linha fica fixa em baixo.
   - Saíram: a secção Clubes & Grupos (procuram-se na Comunidade) e a caixa
     "Como funcionam os níveis?" (fica o "?").
   - Escala (Francisco, 17 set): Masculino · Feminino · Todos, abre na do
     próprio jogador. Só separa a lista e as posições — os pontos são os
     mesmos (ver lib/rankingScales.js). Pontos calculados à parte por escala:
     por acordar com Ruben e Renato.
   - Francisco, 24 set (Trello #422): só há lugares em Masculino e Feminino,
     e só para quem já jogou. Quem não tem género, quem nunca jogou e quem
     não escolheu o nível aparecem em "Todos". A lista vem sem contas de
     teste (getPublicRankings); a de formar duplas continua a ser a outra. */

const ALWAYS = 'always'

export default function Rankings() {
  const { t, i18n } = useTranslation()
  const headerActions = useHeaderActions()
  const { user, currentOrganizationId, memberships, profile } = useAuth()
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()

  // Quem chega com state.tab (Perfil → "Ranking global", links antigos)
  // abre no sítio equivalente.
  const initialTab = location.state?.tab
  const [mode, setMode] = useState(initialTab === 'assiduidade' ? 'xp' : 'ranking')
  const [scope, setScope] = useState(
    (initialTab === 'geral' || initialTab === 'mensal') && currentOrganizationId ? currentOrganizationId : 'global'
  )
  const [period, setPeriod] = useState(ALWAYS)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState([])
  const [months, setMonths] = useState([])
  const [loading, setLoading] = useState(true)
  const [highlightId, setHighlightId] = useState(null)
  const wantMonthly = useRef(initialTab === 'mensal')
  // null = ainda não escolheu → a escala do próprio (o perfil pode chegar
  // depois do primeiro render).
  const [scaleChoice, setScaleChoice] = useState(null)
  const scale = scaleChoice ?? defaultScale(profile?.gender)

  // «Do mês» (#626): sai só se a função do Dev 3 não existir. Começa à
  // vista, para o separador não saltar de 2 para 3 opções ao chegarem os
  // dados (UX, 18 out).
  const [monthReady, setMonthReady] = useState(true)
  const [monthShare, setMonthShare] = useState(null)
  useEffect(() => {
    supabase.rpc('get_month_ranking_months', { p_organization_id: null })
      .then(({ error }) => {
        const ready = !error || errorKind(error) !== 'not_ready'
        setMonthReady(ready)
        if (!ready) setMode((m) => (m === 'month' ? 'ranking' : m))
      })
  }, [])

  const scopeOptions = useMemo(() => [
    { value: 'global', label: t('rankings.scope_global') },
    ...memberships
      .filter((m) => m.organization)
      .map((m) => ({ value: m.organization_id, label: m.organization.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt')),
  ], [memberships, t])

  // Muda de âmbito → período volta a "Sempre" (os meses são de cada clube).
  useEffect(() => {
    setPeriod(ALWAYS)
    setMonths([])
  }, [scope])

  // ── Carregar ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    if (mode === 'month') return undefined
    setLoading(true)

    const load = async () => {
      if (mode === 'xp') {
        // Sem contas de teste (migration_rankings_visiveis.sql). Se a
        // migração ainda não correu, a antiga — o ecrã não pode partir.
        const args = { p_organization_id: scope === 'global' ? null : scope }
        let { data, error } = await supabase.rpc('get_public_xp_rankings', args)
        if (error && errorKind(error) === 'not_ready') {
          ({ data, error } = await supabase.rpc('get_xp_rankings', args))
        }
        if (error) throw error
        return (data || []).map((p) => {
          const tier = tierFromXp(p.xp)
          return {
            user_id: p.user_id, name: p.name, avatar_url: p.avatar_url, ranked: true,
            sub: tier ? `${t('profile.xp_level', { level: tier.level })} · ${t(tier.labelKey)}` : '',
            value: formatXp(p.xp), valueLabel: t('rankings.xp_label'),
          }
        })
      }

      if (scope === 'global') {
        const data = await getPublicRankings()
        return data.map(toRatingRow)
      }

      // Um clube ou grupo: meses (para a pastilha de período) + lista.
      // Estas duas o ecrã monta sozinho, por isso tira aqui os professores
      // que não querem aparecer (o Global e o XP já vêm filtrados).
      const [monthly, hidden] = await Promise.all([loadMonthly(scope), getRankingHiddenIds().catch(() => new Set())])
      if (!cancelled) {
        setMonths(monthly.months)
        if (wantMonthly.current && monthly.months[0]) {
          wantMonthly.current = false
          setPeriod(monthly.months[0].key)
        }
      }
      if (period !== ALWAYS) {
        return withoutHidden(monthly.byMonth[period], hidden).map((p) => ({
          // Está na lista do mês porque jogou nesse mês.
          user_id: p.user_id, name: p.user?.name || '—', avatar_url: null, gender: p.user?.gender, ranked: true, played: true,
          sub: `${t('rankings.mix_count', { count: p.participations })} · 🏆 ${t('rankings.mixes_won_count', { count: p.mixesWon })}`,
          value: p.points > 0 ? `+${p.points}` : String(p.points), valueLabel: t('rankings.points_label'),
        }))
      }
      return withoutHidden(await loadOrganizationRanking(scope), hidden).map(toRatingRow)
    }

    load()
      .then((data) => { if (!cancelled) setRows(data) })
      .catch((error) => {
        console.error('Error loading rankings:', error)
        if (!cancelled) setRows([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scope, period, i18n.language])

  const toRatingRow = (p) => ({
    user_id: p.user_id,
    name: p.name,
    avatar_url: p.avatar_url,
    rating: p.rating,
    gender: p.gender,
    rating_games: p.rating_games,
    mixes_played: p.mixes_played,
    // Sem nível = sem rating: vai para o fim, sem posição nem pontos.
    ranked: p.rating != null,
    // «N jogos» (R6): os jogos que contaram para o nível.
    sub: t('month.games', { count: p.rating_games || 0 }),
    value: p.rating != null ? formatRatingMaybeProvisional(p.rating, p.rating_games) : null,
    valueLabel: isProvisional(p.rating_games) ? t('rankings.provisional_label') : t('rankings.points_label'),
    provisional: isProvisional(p.rating_games),
  })

  const loadMonthly = async (orgId) => {
    const { data, error } = await supabase
      .from('mix_player_stats')
      // games(*) e não games(date, ranked): não rebenta antes de
      // migration_mix_ranked.sql criar a coluna.
      .select('*, user:profiles!mix_player_stats_user_id_fkey (name, gender), game:games (*)')
      .eq('organization_id', orgId)
    if (error) throw error
    return buildMonthlyLeaderboard(data || [], i18n.language)
  }

  // Todos os membros, com ou sem jogos (migration_rankings_everyone.sql).
  // Antes dessa migração correr: o cálculo antigo no ecrã.
  const loadOrganizationRanking = async (orgId) => {
    const { data, error } = await supabase.rpc('get_organization_player_rankings', { p_organization_id: orgId })
    if (!error) return data || []
    if (errorKind(error) !== 'not_ready') throw error

    const [{ data: statsRows, error: statsError }, { data: members, error: membersError }] = await Promise.all([
      supabase.from('player_stats').select('*').eq('organization_id', orgId),
      supabase
        .from('memberships')
        .select('user_id, is_guest, profile:profiles(name, avatar_url, rating, gender, rating_games)')
        .eq('organization_id', orgId),
    ])
    if (statsError) throw statsError
    if (membersError) throw membersError
    const byUser = new Map((members || []).map((m) => [m.user_id, m]))
    return (statsRows || [])
      .map((stat) => {
        const m = byUser.get(stat.user_id)
        if (!m || m.is_guest) return null
        const played = (stat.game_wins || 0) + (stat.game_losses || 0)
        return {
          user_id: stat.user_id, name: m.profile?.name, avatar_url: m.profile?.avatar_url,
          rating: m.profile?.rating ?? null, gender: m.profile?.gender, rating_games: m.profile?.rating_games,
          mix_wins: stat.mix_wins, mixes_played: stat.mixes_played, game_wins: stat.game_wins,
          winRate: winRatePct(stat.game_wins || 0, played),
        }
      })
      .filter(Boolean)
      .sort((a, b) =>
        (b.rating ?? -1) - (a.rating ?? -1) ||
        (b.mix_wins || 0) - (a.mix_wins || 0) ||
        (b.game_wins || 0) - (a.game_wins || 0) ||
        b.winRate - a.winRate
      )
  }

  // ── Posições ─────────────────────────────────────────────────────────
  // Com nível primeiro, pela ordem que veio; sem nível no fim, A–Z.
  // Ranking: por escala (lib/rankingScales). Assiduidade: lista única.
  const byScale = mode === 'ranking' || mode === 'month'

  // Pesquisa sem acentos: «goncalves» encontra «Gonçalves».
  const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const trimmed = query.trim()
  const matchesQuery = (r) => norm(r.name).includes(norm(trimmed))

  // Quem se procura aparece sempre (pedido do Francisco, 24 set). Se na
  // escala aberta (Masculino / Feminino) não há ninguém com esse nome —
  // porque a pessoa não tem sexo, não tem nível ou nunca jogou — mas em
  // «Todos» há, a lista passa sozinha para «Todos» e o menu mostra-o. É só
  // enquanto houver texto: ao limpar a pesquisa volta à escala que estava,
  // porque a escolha da pessoa (`scaleChoice`) nunca é mexida.
  const searchWidened = byScale && !!trimmed && scale !== 'all'
    && !applyScale(rows, scale).some(matchesQuery)
    && applyScale(rows, 'all').some(matchesQuery)
  const shownScale = searchWidened ? 'all' : scale

  const positioned = useMemo(() => {
    if (byScale) return applyScale(rows, shownScale)
    const ranked = rows.filter((r) => r.ranked).map((r, i) => ({ ...r, position: i + 1 }))
    const unranked = rows
      .filter((r) => !r.ranked)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt'))
      .map((r) => ({ ...r, position: null }))
    return [...ranked, ...unranked]
  }, [rows, shownScale, byScale])
  const allScales = byScale && shownScale === 'all'

  // O pódio 1·2·3 também no Ranking e na Assiduidade (Francisco, 12 out):
  // os três primeiros saem da lista e vão para o cartão. No «Todos» do
  // Ranking não há lugares (cada um tem o da sua escala), e com pesquisa
  // fica só a lista.
  const podiumRows = mode !== 'month' && !trimmed && !allScales
    ? positioned.filter((r) => r.ranked && r.position && r.position <= 3).sort((a, b) => a.position - b.position)
    : []
  const podiumIds = new Set(podiumRows.map((r) => r.user_id))
  const podiumValue = (row) => ({ text: mode === 'xp' ? `${row.value} ${t('rankings.xp_label')}` : row.value, muted: false })
  // Molduras do pódio do mês (quem fechou o mês passado no pódio), na lista.
  const frames = useFrames(rows.map((r) => r.user_id))
  const visible = (trimmed ? positioned.filter(matchesQuery) : positioned).filter((r) => !podiumIds.has(r.user_id))
  // A tua linha: a tua posição na tua escala, mesmo quando se vê outra.
  const me = byScale
    ? applyScale(rows, 'all').find((r) => r.user_id === user.id)
    : positioned.find((r) => r.user_id === user.id)
  const myTotal = byScale && me ? rankedCount(rows, me.scale) : positioned.filter((r) => r.ranked).length
  const firstUnrankedIndex = allScales ? -1 : visible.findIndex((r) => !r.ranked)

  const scrollToPlayer = (userId) => {
    setQuery('')
    setHighlightId(userId)
    // Espera a lista completa voltar a estar no DOM.
    setTimeout(() => {
      document.getElementById(`ranking-player-${userId}`)?.scrollIntoView({ block: 'center' })
    }, 50)
    setTimeout(() => setHighlightId(null), 2200)
  }

  // Perfil → "Ranking global": salta para a própria linha, uma vez. Não num
  // voltar atrás (Layout repõe o scroll — Trello #245).
  const scrolledToMe = useRef(false)
  useEffect(() => {
    if (navigationType === 'POP' || scrolledToMe.current) return
    if (!location.state?.scrollToMe || loading) return
    const el = document.getElementById(`ranking-player-${user.id}`)
    if (!el) return
    scrolledToMe.current = true
    el.scrollIntoView({ block: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rows])

  const positionStyle = (position) => {
    if (position === 1) return 'bg-lime-400 text-ink-900'
    if (position === 2) return 'bg-ink-900 text-white'
    if (position === 3) return 'bg-ink-700 text-white'
    // Do 4.º em diante, só o número (R6), como no «Do mês».
    return 'text-ink-900'
  }

  const renderValue = (row, onDark = false) => allScales && !onDark ? (
    // "Todos": a posição de cada um na sua escala, não os pontos lado a lado.
    <span className={`shrink-0 text-[11px] font-extrabold px-2 py-1 rounded-full tabular-nums ${row.position ? 'bg-ink-50 text-ink-900' : 'bg-ink-50 text-muted'}`}>
      {row.position ? `${row.position} · ${t(`rankings.scale_short_${row.scale}`)}` : t(`rankings.reason_${row.reason || 'no_level'}`)}
    </span>
  ) : row.ranked ? (
    <div className="text-right shrink-0">
      <p className={`text-lg font-extrabold tabular-nums leading-tight ${onDark ? 'text-white' : 'text-ink-900'}`}>{row.value}</p>
      <p className={`text-[10px] ${row.provisional ? 'text-lime-600 font-extrabold' : onDark ? 'text-white/60' : 'text-muted'}`}>{row.valueLabel}</p>
    </div>
  ) : (
    <span className={`shrink-0 text-[11px] font-extrabold px-2 py-1 rounded-full ${onDark ? 'bg-white/10 text-white/80' : 'bg-ink-50 text-muted'}`}>
      {t('rankings.no_level')}
    </span>
  )

  const renderRow = (row, index) => {
    const isMe = row.user_id === user.id
    return (
      <div key={row.user_id}>
        {index === firstUnrankedIndex && index > 0 && (
          <p className="px-4 pt-4 pb-1 text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('rankings.end_of_list')}</p>
        )}
        <Link
          id={`ranking-player-${row.user_id}`}
          to={`/jogador/${row.user_id}`}
          className={`flex items-center gap-3 px-3.5 py-2.5 transition-colors duration-fast hover:bg-ink-50 ${
            highlightId === row.user_id ? 'bg-lime-400/25' : isMe ? 'bg-lime-400/10' : ''
          }`}
        >
          {!allScales && (
            <span className={`w-8 h-8 rounded-ctrl flex items-center justify-center text-sm font-extrabold tabular-nums shrink-0 ${row.position ? positionStyle(row.position) : 'bg-ink-50 text-muted'}`}>
              {row.position ?? '—'}
            </span>
          )}
          <Avatar name={row.name} url={row.avatar_url} size="w-9 h-9 text-xs" frame={frames[row.user_id]} />
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-ink-900 text-sm flex items-center gap-1.5 min-w-0">
              {/* A parte encontrada a lima-claro (pesquisa, 14 out). */}
              <span className="truncate min-w-0"><Realce text={row.name || ''} query={trimmed} /></span>
              {isMe && <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-wide text-lime-600">{t('rankings.you_badge')}</span>}
            </p>
            <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
              {row.rating != null && <span className="shrink-0 flex"><RatingBadge rating={row.rating} gender={row.gender} /></span>}
              {!row.ranked && mode === 'ranking' && period === ALWAYS && (
                <span className="text-[11px] text-muted truncate">{t('rankings.no_level_hint')}</span>
              )}
              {row.ranked && row.sub && <span className="text-[11px] text-muted truncate">{row.sub}</span>}
            </div>
            {trimmed && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); scrollToPlayer(row.user_id) }}
                className="text-[11px] font-extrabold text-ink-700 underline underline-offset-2 mt-0.5"
              >
                {t('rankings.see_in_list')}
              </button>
            )}
          </div>
          {renderValue(row)}
        </Link>
      </div>
    )
  }

  const monthOptions = [
    { value: ALWAYS, label: t('rankings.period_always') },
    ...months.map((m) => ({ value: m.key, label: m.label.charAt(0).toUpperCase() + m.label.slice(1) })),
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        sticky={false}
        title={(
          <span className="inline-flex items-center gap-2">
            {t('rankings.title')}
            {/* R6 (13 out): o «?» redondo abre o «Como funciona» do separador. */}
            <Link to={mode === 'xp' ? '/ajuda#xp' : '/ajuda#ranking'} aria-label={t('rankings.help_aria')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink-700 hover:text-ink-900">
              <HelpCircle size={17} />
            </Link>
          </span>
        )}
      >
        {headerActions}
      </PageHeader>

      {/* R6 + R4: o separador e a barra presos em cima, num bloco branco. A
          lupa troca a barra pelo campo (no «Do mês» não há pesquisa). */}
      <StickyTop>
        <Tabs
          value={mode}
          onChange={setMode}
          options={[
            { value: 'ranking', label: t('rankings.mode_ranking') },
            ...(monthReady ? [{ value: 'month', label: t('rankings.tab_month') }] : []),
            { value: 'xp', label: t('rankings.tab_assiduity') },
          ]}
        />
        <FilterBar search={mode !== 'month' ? { value: query, onChange: setQuery, placeholder: t('rankings.search_placeholder') } : null}>
            {byScale && (
              <Select
                variant="chip" className="shrink-0"
                value={shownScale}
                onChange={setScaleChoice}
                options={SCALES.map((s) => ({ value: s, label: t(`rankings.scale_${s}`) }))}
                placeholder={t('rankings.scale_title')}
              />
            )}
            <Select variant="chip" className="shrink-0" active={scope !== 'global'} value={scope} onChange={setScope} options={scopeOptions} placeholder={t('rankings.scope_title')} />
            {mode === 'ranking' && scope !== 'global' && months.length > 0 && (
              <Select
                variant="chip" className="shrink-0"
                active={period !== ALWAYS}
                value={period}
                onChange={setPeriod}
                options={monthOptions}
                placeholder={t('rankings.period_title')}
              />
            )}
        </FilterBar>
      </StickyTop>

      {mode === 'month' ? (
        <MonthRanking scope={scope} scale={shownScale} scopeLabel={scopeOptions.find((o) => o.value === scope)?.label} onShare={setMonthShare} />
      ) : loading ? (
        // A forma da lista em vez da roda (esqueletos, 12 out; Francisco, 18 out).
        <SkeletonGate><RankingSkeleton /></SkeletonGate>
      ) : visible.length === 0 && podiumRows.length === 0 ? (
        <EmptyState
          icon={trimmed ? Search : mode === 'xp' ? Award : Trophy}
          title={trimmed ? t('rankings.no_player_found_title') : mode === 'xp' ? t('rankings.empty_xp_title') : t('rankings.empty_global_title')}
          subtitle={trimmed ? t('comunidade.try_another_name') : mode === 'xp' ? t('rankings.empty_assiduity_subtitle') : t('rankings.empty_global_subtitle')}
        />
      ) : (
        <>
          {/* Um título por separador, sempre no mesmo sítio (R6). Com pesquisa,
              quantas pessoas a pesquisa encontrou. */}
          {trimmed ? (
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">
              {t('rankings.players_found', { count: visible.length + podiumRows.length })}
            </p>
          ) : (
            <div>
              <h2 className="font-display text-2xl font-extrabold text-ink-900 leading-tight">
                {mode === 'xp' ? t('rankings.title_xp') : scope === 'global' ? t('rankings.title_global') : scopeOptions.find((o) => o.value === scope)?.label}
              </h2>
              <p className="text-xs text-muted mt-0.5">
                {mode === 'xp' ? t('rankings.sub_xp')
                  : t(shownScale === 'feminino' ? 'rankings.sub_count_f' : 'rankings.sub_count', { count: allScales ? positioned.length : rankedCount(rows, shownScale), scale: t(`rankings.scale_${shownScale}`) })}
              </p>
            </div>
          )}
          {podiumRows.length > 0 && (
            <RankPodium id="rank-podium" spots={[0, 1, 2].map((i) => podiumRows[i] || null)} value={podiumValue} meId={user.id}
              onOpen={(id) => navigate(`/jogador/${id}`)}
              onShare={() => setMonthShare({
                kind: mode === 'xp' ? 'xp' : 'ranking',
                title: mode === 'xp' ? t('monthshare.title_xp') : t(`rankings.scale_${shownScale}`),
                podium: [0, 1, 2].map((i) => podiumRows[i] && { ...podiumRows[i], display: podiumValue(podiumRows[i]).text }),
              })} />
          )}
          {allScales && !trimmed && (
            <p className="text-xs text-muted">{t('rankings.all_scales_hint')}</p>
          )}
          <div className="rounded-card border border-line bg-white overflow-hidden divide-y divide-line">
            {visible.map(renderRow)}
          </div>
        </>
      )}

      {/* A tua linha, sempre à vista por cima da barra de navegação. */}
      {monthShare && (
        <MonthPodiumShare share={monthShare} onClose={() => setMonthShare(null)}
          org={scope === 'global' ? null : (memberships.find((m) => m.organization_id === scope)?.organization || null)} />
      )}

      {mode !== 'month' && !loading && me && (
        <button
          type="button"
          onClick={() => scrollToPlayer(me.user_id)}
          className="sticky bottom-24 z-10 w-full flex items-center gap-3 px-3.5 py-2.5 rounded-card bg-ink-900 text-white shadow-lift text-left"
        >
          <span className={`w-8 h-8 rounded-ctrl flex items-center justify-center text-sm font-extrabold tabular-nums shrink-0 ${me.position ? 'bg-lime-400 text-ink-900' : 'bg-white/10 text-white'}`}>
            {me.position ?? '—'}
          </span>
          <Avatar name={me.name} url={me.avatar_url} size="w-9 h-9 text-xs" />
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-sm truncate">{t('rankings.you_row')}</p>
            {/* O nível ao lado da posição: os pontos sozinhos não dizem se
                se é M4 ou M5 (pedido do Francisco, 17 set). */}
            <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
              {me.rating != null && <span className="shrink-0 flex"><RatingBadge rating={me.rating} gender={me.gender} onDark /></span>}
              <p className="text-[11px] text-white/60 truncate">
                {me.position
                  ? `${t('rankings.your_position', { position: me.position, total: myTotal })}${byScale ? ` · ${t(`rankings.scale_${me.scale}`)}` : ''}`
                  : t(`rankings.reason_${me.reason || 'no_level'}_hint`)}
              </p>
            </div>
          </div>
          {renderValue(me, true)}
        </button>
      )}
    </div>
  )
}
