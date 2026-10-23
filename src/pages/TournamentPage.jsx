// Página do torneio (Trello #361, «Torneio 1/6») — print 05 do desenho
// aprovado (design-handoff/2026-09-19-torneios). É o ESQUELETO onde os
// outros ecrãs se penduram: topo em cartão grande (mesma regra dos mixes),
// seletor de categoria — abre sempre na categoria de quem está a ver — e os
// cinco separadores «Os meus jogos · Grupos · Quadro · Calendário ·
// Inscritos». Cada separador vem de src/components/tournament/panels.js,
// onde o Dev 2 e o Dev 3 registam os deles com uma linha.
//
// Abre sem conta (SPEC §4.9): o link do torneio anda no WhatsApp e em
// cartazes. Sem sessão vê-se tudo menos o botão de inscrever.
//
// Enquanto a migração do torneio não correr, a RPC não existe: a página
// mostra o estado vazio em vez de rebentar.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BackBar } from '../components/ui'
import { shareMessage, tournamentUrl } from '../lib/tournamentPublic'
import { whatsappShare } from '../lib/partnerInvite'
import { ArrowLeft, Eye, Trophy } from 'lucide-react'
import { useGoBack } from '../lib/useGoBack'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getTournamentForEdit, getTournamentOrgHint, getTournamentPage, getTournamentResults, scheduleTournamentOpening, setTournamentStatus, updateTournament } from '../lib/tournamentApi'
import GroupOnlyNotice from '../components/GroupOnlyNotice'
import { StickyTabs } from '../components/tournament/StickyBar'
import { setEventWhatsappPostTimes } from '../lib/whatsappHours'
import { describeError, errorKind } from '../lib/errors'
import { EmptyState, LoadErrorState, Tabs } from '../components/ui'
import { CategorySelect, MonoLabel } from '../components/tournament/TournamentBits'
import { TOURNAMENT_PANELS, TOURNAMENT_TABS, TOURNAMENT_TAB_OWNER } from '../components/tournament/panels'
import AdminBar from '../components/tournament/AdminBar'
import CreateTournamentForm from '../components/tournament/CreateTournamentForm'
import ChampionsBlock from '../components/tournament/ChampionsBlock'
import NextGameCard, { useMyNextGame } from '../components/tournament/NextGameCard'
import { canCancel, cancelDanger } from '../components/tournament/cancelTournament'
import DrawAdminPanel from '../components/tournament/DrawAdminPanel'
import TournamentCalendarGrid from '../components/tournament/TournamentCalendarGrid'
import ScorekeepersPanel from '../components/tournament/ScorekeepersPanel'
import { drawProgress, statusKey } from '../components/tournament/drawProgress'
import { TournamentPageSkeleton, PanelSkeleton } from '../components/tournament/TournamentSkeleton'
import { useSkeleton, useLoadTimeout } from '../components/Skeleton'
import { activeEntriesOf, entriesOpen } from '../lib/tournamentSignup'
import EventHero from '../components/event/EventHero'
import EventFacts from '../components/event/EventFacts'
import { daysAside, longDate, shortDay } from '../components/event/heroDates'
import PublicInfo from '../components/tournament/PublicInfo'
import { appOrigin } from '../lib/native'

/** "9–11 out" quando é tudo no mesmo mês, "30 set – 2 out" quando não é. */
function dateRange(startIso, endIso, locale) {
  if (!startIso) return ''
  const a = new Date(`${startIso}T12:00`)
  const b = endIso ? new Date(`${endIso}T12:00`) : a
  const month = (d) => d.toLocaleDateString(locale, { month: 'short' }).replace('.', '')
  if (a.getTime() === b.getTime()) return `${a.getDate()} ${month(a)}`
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${month(b)}`
  return `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}`
}

// As datas do topo (R3): heroDates.js — aceitam data ou instante, e nunca rebentam.
// As minhas inscrições ativas: activeEntriesOf (tournamentSignup.js).
const activeEntries = activeEntriesOf
const activeMy = (data) => activeEntries(data)[0] || null

export default function TournamentPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const location = useLocation()
  const goBack = useGoBack('/')
  const navigate = useNavigate()
  const { user, memberships, profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  // Sobe a cada toque num separador ou na categoria (StickyTabs pullKey).
  const [pullKey, setPullKey] = useState(0)
  // Torneio de um grupo onde não estou: diz de que grupo é, em vez de «não
  // encontrado» (SPEC 2026-10-01-jogo-de-grupo-fechado, ponto 7).
  const [orgHint, setOrgHint] = useState(null)
  useEffect(() => {
    if (!failed || !user || !id) { setOrgHint(null); return undefined }
    let alive = true
    getTournamentOrgHint(id).then((h) => { if (alive) setOrgHint(h) }).catch(() => {})
    return () => { alive = false }
  }, [failed, user, id])
  // Editar e sortear abrem AQUI. O formulário de editar não tem rota própria
  // — vive em estado do painel do Gerir — por isso não havia para onde
  // navegar, e a versão de hoje mandava para `/gerir`, que é o ecrã de
  // escolher organização. Fica no endereço para o botão de trás funcionar.
  const [editing, setEditing] = useState(null)
  const [adminError, setAdminError] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => getTournamentPage(id)
      .then((res) => { if (alive) (res?.tournament ? setData(res) : setFailed(true)) })
      .catch((error) => {
        if (errorKind(error) !== 'not_ready') console.error('Error loading tournament:', error)
        if (alive) setFailed(true)
      })
    load()
    // Os painéis avisam com `tournament:reload` depois de inscrever, desistir
    // ou publicar um aviso. Sem este ouvinte a página ficava como estava —
    // quem desistia continuava a ler «Estás inscrito» (Trello #429).
    const reload = () => { load() }
    window.addEventListener('tournament:reload', reload)
    return () => { alive = false; window.removeEventListener('tournament:reload', reload) }
  }, [id])

  // O formulário de editar carrega-se pelo endereço (?admin=editar): assim
  // abre do botão da barra e também do «Editar» da linha do torneio no Gerir
  // (ações do evento, 30 set), com o botão de trás a funcionar.
  const tourId = data?.tournament?.id
  const wantsEdit = params.get('admin') === 'editar'
  // Um torneio cancelado não abre o editar sozinho: o ?admin=editar que
  // ficou no endereço sai sem deixar rasto (bug do Francisco, 5 out).
  const cancelled = data?.tournament?.status === 'cancelado'
  // Terminado: o meu lugar, para a faixa do topo («Terminado · ficaste em
  // 2.º na F3», UX 13 out). Só se pede a quem esteve inscrito.
  const ended = data?.tournament?.status === 'terminado'
  // A minha dupla, para a faixa do topo de quem está inscrito («M3 · Tu e
  // Ana Moreira», protótipo; QA 13 out). Os nomes vêm da lista pública de
  // inscritos, como no SignupSlot.
  const myEntryId = activeMy(data)?.entry_id || null
  const [myPair, setMyPair] = useState(null)
  useEffect(() => {
    if (!myEntryId) { setMyPair(null); return undefined }
    let alive = true
    supabase.from('tournament_public_entries').select('player1_name, player2_name').eq('id', myEntryId).limit(1)
      .then(({ data: rows, error }) => {
        if (error) throw error
        if (alive) setMyPair(rows?.[0] || null)
      })
      .catch(() => { if (alive) setMyPair(null) })
    return () => { alive = false }
  }, [myEntryId])
  const hadEntry = !!activeMy(data)
  const [myPlace, setMyPlace] = useState(null)
  useEffect(() => {
    const tr = data?.tournament
    if (!ended || !hadEntry || !tr) { setMyPlace(null); return undefined }
    let alive = true
    getTournamentResults(tr.slug || tr.id)
      .then((res) => { if (alive) setMyPlace(res?.my?.final_position ? { n: res.my.final_position, code: res.my.category_code } : null) })
      .catch(() => { if (alive) setMyPlace(null) })
    return () => { alive = false }
  }, [ended, hadEntry, data?.tournament?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!wantsEdit || !cancelled) return
    const next = new URLSearchParams(params); next.delete('admin'); setParams(next, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsEdit, cancelled])
  useEffect(() => {
    if (!wantsEdit || !tourId || editing || cancelled) return undefined
    let alive = true
    getTournamentForEdit(tourId)
      .then((d) => {
        if (!alive) return
        if (!d?.tournament) throw new Error('not ready')
        setEditing(d)
      })
      .catch((err) => {
        if (errorKind(err) !== 'not_ready') console.error('Error loading tournament:', err)
        if (alive) setAdminError(describeError(t, err, 'tournament.admin.edit_error'))
      })
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsEdit, tourId])

  const categories = data?.categories || []
  // O meu próximo jogo, do quadro da minha categoria sorteada (1 out).
  const myGame = useMyNextGame(activeEntries(data), categories, data?.my_matches || [])
  // A categoria e o separador vivem no endereço: o link que se partilha no
  // WhatsApp tem de abrir no mesmo sítio para quem o recebe.
  const catParam = params.get('cat')
  const category = useMemo(() => {
    const byCode = categories.find((c) => c.code?.toLowerCase() === catParam?.toLowerCase())
    if (byCode) return byCode
    const mine = categories.find((c) => c.id === activeMy(data)?.category_id)
    return mine || categories[0] || null
  }, [categories, catParam, data])

  // Links antigos (?tab=grupos/quadro/calendario) continuam a abrir onde a
  // pessoa esperava: esses três passaram a secções de «Todos os jogos» a 23
  // set. O endereço do torneio anda no WhatsApp e em cartazes — não pode
  // deixar de funcionar por causa de uma arrumação nossa.
  const tabParam = params.get('tab')
  const LEGACY_TABS = { groups: 'board', draw: 'board', all_games: 'board', calendar: 'schedule' }
  // «Quadro · Horário · Duplas», iguais para todos, a abrir no Quadro
  // (revisão de 28 set). «Os meus jogos» abre-se pelo botão lima de quem
  // joga — não é separador; sem inscrição, cai no Quadro.
  const entered = activeEntries(data).length > 0
  // «Os meus jogos» só com jogos (depois do sorteio da minha categoria): antes
  // abria vazio, e ficava um segundo lima ao lado do «Inscrever a minha
  // dupla» (Francisco, 1 out: «dois botões verdes????»). Os jogos vêm do
  // quadro: o `my_matches` da página nunca veio da base de dados (#508).
  const hasGames = myGame.hasGames
  // Só 2 ou 3 separadores (regra de 24 set): «Os meus jogos» não é um deles.
  const tabs = TOURNAMENT_TABS
  const asked = LEGACY_TABS[tabParam] || tabParam
  const tab = tabs.includes(asked) || (asked === 'my_games' && entered) ? asked : tabs[0]

  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    next.set(key, value)
    setParams(next, { replace: true, state: { keepScroll: true } })
  }

  const shareTournament = () => {
    const tour = data?.tournament
    if (!tour) return
    const text = shareMessage(tour, appOrigin())
    if (navigator.share) { navigator.share({ title: tour.name, text, url: tournamentUrl(tour, appOrigin()) }).catch(() => {}); return }
    window.open(whatsappShare(text), '_blank')
  }
  const showSkeleton = useSkeleton(!data && !failed)
  const loadLate = useLoadTimeout(!data && !failed)
  const skeletonShown = useRef(false)
  if (showSkeleton) skeletonShown.current = true
  const back = <BackBar onBack={goBack} title={data?.tournament?.name} onShare={data?.tournament?.status === 'rascunho' ? undefined : shareTournament} />

  if (failed && orgHint) {
    return (
      <div className="space-y-5">
        <BackBar onBack={goBack} />
        <GroupOnlyNotice hint={orgHint} keyPrefix="tournament.closed" />
      </div>
    )
  }
  if (failed) {
    return (
      <div className="space-y-5">
        {back}
        <EmptyState icon={Trophy} title={t('tournament.not_found_title')} subtitle={t('tournament.not_found_subtitle')} />
      </div>
    )
  }
  // A carregar: o «‹» a sério e o resto a cinzento, só depois de 0,2 s; ao
  // fim de 8 s, o erro de sempre (esqueletos, 12 out). O «⤴» só com os
  // dados: antes não se sabe se é um rascunho, que não se partilha (#544).
  if (!data) {
    return (
      <div className="space-y-4">
        <BackBar onBack={goBack} />
        {loadLate
          ? <LoadErrorState title={t('app.load_error_title')} />
          : showSkeleton ? <TournamentPageSkeleton /> : null}
      </div>
    )
  }

  const tour = data.tournament
  // «Ver como quem chega de fora»: a MESMA página com `?ver=publico`, nunca
  // outro separador do browser — quem usa isto está no clube, de telemóvel,
  // a conferir como o link aparece a quem o recebe. Some a barra de admin e
  // fica tudo o resto, INCLUSIVE o botão de inscrever: se estiver partido é
  // isso mesmo que o admin precisa de ver.
  const publicView = params.get('ver') === 'publico'
  const adminMode = params.get('admin')   // 'editar' | 'sorteio' | 'horario'
  // O superadmin organiza sem ser membro (os superadmins escondidos, 18 out:
  // deixou de ficar inscrito nos grupos onde não joga) — conta como quem
  // organiza, como no mix.
  const canManage = !!memberships?.find((m) => m.organization_id === tour.organization_id)?.is_admin || profile?.is_platform_admin === true
  const isAdmin = canManage && !publicView
  const Panel = TOURNAMENT_PANELS[tab]
  const TopSlot = TOURNAMENT_PANELS.top
  const UnderHeader = TOURNAMENT_PANELS.under_header
  const Podium = TOURNAMENT_PANELS.podium
  // Dentro = até às vagas de cada categoria; o resto espera (suplentes).
  // Depois de fechar, os suplentes vêm à parte (waitlist_count, Dev 3).
  const teamsIn = categories.length
    ? categories.reduce((n, c) => n + (c.slots ? Math.min(c.entry_count || 0, c.slots) : (c.entry_count || 0)), 0)
    : null
  const waiting = categories.reduce((n, c) => n + (c.slots ? Math.max(0, (c.entry_count || 0) - c.slots) : 0) + (c.waitlist_count || 0), 0)
  const panelProps = {
    hasGames: hasGames && !publicView,
    tournament: tour,
    categories,
    category,
    my: activeMy(data),
    myEntries: activeEntries(data),
    myMatches: data.my_matches || [],
    isAdmin,
    // «Ver como quem chega de fora»: os painéis escondem o que é de quem
    // organiza ou marca (revisão dos torneios, 28 set).
    publicView,
  }
  // kind: num grupo, o preço especial diz «Membros do grupo» (QA, 11 out).
  // O clube ou grupo no topo abre a página dele, como no mix (QA, 19 out). O
  // endereço vem do get_tournament_page (club_slug, Dev 3); até lá, só quem é
  // membro o tem, pelas suas organizações.
  const clubSlug = tour.club_slug || memberships?.find((m) => m.organization_id === tour.organization_id)?.organization?.slug || null
  const clubForForm = { id: tour.organization_id, name: tour.club_name, location: tour.location, kind: tour.club_kind }

  const openAdmin = async (modo) => {
    setAdminError('')
    // O «editar» carrega-se no efeito do endereço (lá em cima).
    // Marca que veio da página: ao fechar volta-se atrás, em vez de empilhar
    // outra página por cima — senão o «voltar» da página reabria o editar,
    // num ciclo sem saída (bug do Francisco, 5 out).
    const next = new URLSearchParams(params); next.set('admin', modo); setParams(next, { state: { adminFromPage: true } })
  }

  const closeAdmin = () => {
    setEditing(null); setAdminError('')
    if (location.state?.adminFromPage) { navigate(-1); return }
    // Chegou direto ao ?admin=… (do Gerir, de um link): troca-se a entrada,
    // para o ?admin não ficar no histórico.
    const next = new URLSearchParams(params); next.delete('admin'); next.delete('cat'); setParams(next, { replace: true })
  }

  const saveEdit = async (draft) => {
    setSavingEdit(true); setAdminError('')
    try {
      await updateTournament(tour.id, draft)
      // As horas do WhatsApp gravam-se à parte (Dev 3).
      if (Array.isArray(draft.whatsapp_post_times)) await setEventWhatsappPostTimes('tournament', tour.id, draft.whatsapp_post_times)
      // «Abrem as inscrições» mudou num rascunho (#586).
      if (draft.schedule_opening) await scheduleTournamentOpening(tour.id, draft.schedule_opening.at)
      closeAdmin()
      window.dispatchEvent(new Event('tournament:reload'))
    } catch (err) {
      setAdminError(err?.code === 'special_prices_failed' ? t('tournament.edit.special_failed')
        // Com inscritos, o máximo de categorias só sobe (Dev 3: o atual no hint).
        : String(err?.message || '').includes('max_categories_only_up') ? t('tournament.edit.max_only_up', { n: err?.hint || '' })
        // A hora de uma categoria com inscritos (Dev 3, 13 out): o código no hint.
        : String(err?.message || '').includes('category_already_drawn') ? t('tournament.edit.category_already_drawn', { code: err?.hint || '' })
        : String(err?.message || '').includes('day_outside_tournament') ? t('tournament.edit.day_outside_tournament', { code: err?.hint || '' })
        : describeError(t, err))
    } finally {
      setSavingEdit(false)
    }
  }

  // O sorteio e o editar ocupam a página inteira: são um trabalho, não um
  // pedaço da página. Saem pelo «Voltar» deles e pelo botão de trás do
  // telemóvel, porque o modo vive no endereço.
  if (isAdmin && adminMode === 'sorteio') {
    // Sem o «Voltar» da página: o ecrã do sorteio já traz o dele, e dois
    // seguidos deixam quem organiza sem saber qual é qual.
    return <div className="space-y-4"><DrawAdminPanel tournament={tour} onBack={closeAdmin} onEdit={() => openAdmin('editar')} /></div>
  }
  // A grelha de horas (Trello #563): no sítio, como o sorteio; o «Voltar»
  // dela e o do telemóvel regressam à página, porque o modo vive no endereço.
  if (isAdmin && adminMode === 'horario') {
    return <div className="space-y-4"><TournamentCalendarGrid tournament={tour} onBack={closeAdmin} /></div>
  }
  // Quem marca os resultados (#365): o painel existia mas não estava em lado
  // nenhum; abre do «Mais ⋯» de quem organiza (PO, 2 out).
  if (isAdmin && adminMode === 'marcadores') {
    return <div className="space-y-4"><ScorekeepersPanel tournament={tour} onBack={closeAdmin} /></div>
  }
  if (isAdmin && adminMode === 'editar' && editing) {
    return (
      <div className="space-y-4">
        <CreateTournamentForm
          club={clubForForm}
          initial={editing}
          locked={!!editing.has_entries}
          focusCode={params.get('cat')}
          danger={canCancel(tour) ? cancelDanger(tour, t, (deleted) => {
            if (deleted) { navigate('/gerir'); return }
            closeAdmin()
            window.dispatchEvent(new CustomEvent('tournament:reload'))
          }, { everEntered: !!editing.has_entries }) : null}
          // «Voltar a rascunho» (Francisco, 10 out): o formulário só o deixa
          // carregar sem inscrições.
          unpublish={async () => {
            await setTournamentStatus(tour.id, 'rascunho')
            closeAdmin()
            window.dispatchEvent(new Event('tournament:reload'))
          }}
          saving={savingEdit}
          error={adminError}
          onCancel={closeAdmin}
          onCreate={saveEdit}
        />
      </div>
    )
  }

  const spinner = <PanelSkeleton />
  // O topo (R3): a hora da primeira categoria do primeiro dia, os dias ao
  // lado («sáb e dom»), e os quadrados de dados.
  const heroIn = ['validada', 'selecionada'].includes(activeMy(data)?.state)
  // «M3 · Tu e Ana Moreira»: a categoria e com quem vou. Sem os nomes, fica
  // «Inscrição feita».
  // Com várias categorias, a primeira e «+1» (UX, CONFORMIDADE-R3 n.º 11).
  const heroMore = activeEntries(data).length - 1
  const heroCode = [categories.find((c) => c.id === activeMy(data)?.category_id)?.code, heroMore > 0 ? `+${heroMore}` : null].filter(Boolean).join(' ') || null
  const heroPartner = myPair ? [myPair.player1_name, myPair.player2_name].filter(Boolean).find((n) => n !== profile?.name) : null
  const heroPair = heroIn && heroCode && heroPartner ? t('tournament.hero_entered_with', { code: heroCode, name: heroPartner }) : null
  const pendingPairs = Number(tour.pending_count ?? categories.reduce((n, c) => n + (Number(c.pending_count) || 0), 0)) || 0
  const todayIso = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' })
  const isToday = !!tour.starts_on && String(tour.starts_on).slice(0, 10) <= todayIso && String(tour.ends_on || tour.starts_on).slice(0, 10) >= todayIso
  const firstDayCats = categories.filter((c) => c.day_date && String(c.day_date).slice(0, 10) === String(tour.starts_on || '').slice(0, 10) && c.start_time)
  const heroTime = firstDayCats.length ? firstDayCats.map((c) => String(c.start_time).slice(0, 5)).sort()[0] : null
  const heroAside = daysAside(tour.starts_on, tour.ends_on, i18n.language, t)
  const totalSlots = categories.reduce((n, c) => n + (Number(c.slots) || 0), 0)
  const shirt = tour.rules?.tshirt
  const euros = (cents) => (cents / 100).toLocaleString(i18n.language, { maximumFractionDigits: 2 })
  const heroFacts = [
    { key: 'days', label: t('tournament.fact_days'), value: dateRange(tour.starts_on, tour.ends_on, i18n.language) },
    { key: 'courts', label: t('tournament.fact_courts'), value: tour.court_count || null },
    { key: 'price', label: t('tournament.fact_price'), value: tour.entry_fee_cents ? t('tournament.fact_price_pair', { price: euros(tour.entry_fee_cents) }) : null },
    { key: 'tshirt', label: t('tournament.fact_tshirt'), value: shirt?.mode === 'gift' ? t('tournament.fact_tshirt_gift') : shirt?.mode === 'sale' ? t('tournament.fact_tshirt_sale', { price: euros(shirt.price_cents || 0) }) : null },
    { key: 'deadline', label: t('tournament.fact_entries'), value: shortDay(tour.entries_deadline, i18n.language) ? t('tournament.fact_until', { date: shortDay(tour.entries_deadline, i18n.language) }) : null },
    { key: 'draw', label: t('tournament.fact_draw'), value: shortDay(tour.draw_on, i18n.language) },
  ]

  return (
    <div className={`space-y-4 ${skeletonShown.current ? 'animate-fill-in' : ''}`}>
      {/* A folha branca do topo vai até à morada e à «Organização: …» (UX,
          14 out — como no protótipo): sobre o fundo novo da app, os quadrados
          e a morada #F4F5F1 ficavam apagados. A categoria e os separadores
          ficam depois, no cinzento. */}
      {/* No computador, a capa e a folha à largura dos cartões de baixo,
          como no mix (Dev 2, 15 out) — saíam 16 px para cada lado. */}
      <div className="-mx-4 space-y-4 rounded-b-[16px] bg-white px-4 pb-5 sm:mx-0">
        {/* R3 — o topo novo (design-handoff/2026-10-13-redesign/R3): a capa com
            o cartaz ou o Alino do torneio, o cartão branco por cima, a hora
            grande, a faixa de estado e, logo por baixo, os botões da inscrição.
            Só aspeto: as ações são as de antes. */}
        <EventHero
          kind="tournament"
          imageUrl={tour.poster_url || null}
          poster
          chip={[t('tournament.label'), categories.length ? t('tournament.hero_categories', { count: categories.length }) : null].filter(Boolean).join(' · ')}
          org={tour.club_name ? { name: tour.club_name, kindLabel: t(tour.club_kind === 'group' ? 'tournament.hero_org_group' : 'tournament.hero_org_club'), logo: tour.club_logo_url, onOpen: clubSlug ? () => navigate(`/clube/${clubSlug}`) : null } : null}
          title={tour.name}
          time={heroTime}
          timeAside={heroAside}
          dateLine={longDate(tour.starts_on, i18n.language)}
          onBack={goBack}
          onShare={tour.status === 'rascunho' ? null : shareTournament}
          // R3b (13 out): a caixa de quem organiza logo a seguir à data, antes
          // da faixa e da inscrição pessoal. Sai a linha «Editar · Mais» de cima.
          nextStep={isAdmin ? (
            <AdminBar
              part="box"
              tournament={tour}
              categories={categories}
              onChanged={() => window.dispatchEvent(new Event('tournament:reload'))}
              onEdit={() => openAdmin('editar')}
              onDraw={() => openAdmin('sorteio')}
              onSchedule={() => openAdmin('horario')}
              onScorekeepers={() => openAdmin('marcadores')}
              onEntries={() => setParam('tab', 'entries')}
            />
          ) : null}
          status={ended || cancelled ? {
            // Terminado ou cancelado (UX, 13 out): faixa cinzenta com o estado do
            // torneio, sem «Inscrição feita» nem vagas. Quem jogou vê o seu lugar.
            text: [t(cancelled ? 'tournament.status_cancelado' : 'tournament.status_terminado'),
              ended && myPlace ? t(myPlace.n === 1 ? 'tournament.hero_done_champions' : 'tournament.hero_done_place', { n: myPlace.n, code: myPlace.code }) : null,
            ].filter(Boolean).join(' · '),
            tone: 'grey',
            dot: cancelled ? '#DC2626' : null,
            meta: [ended ? t('tournament.hero_pairs', { count: teamsIn ?? tour.entry_count ?? 0 }) : null,
              shortDay(tour.ends_on || tour.starts_on, i18n.language)].filter(Boolean).join(' · '),
            note: cancelled && hadEntry ? t('tournament.hero_cancelled_entry') : null,
          } : {
            text: heroIn
              ? (heroPair || t('tournament.state_entered'))
              : t(statusKey(tour.status, drawProgress(categories), tour.entries_deadline), drawProgress(categories)),
            tone: heroIn ? 'ok' : 'kind',
            // «18/32 DUPLAS · HOJE» no dia do torneio (protótipo; QA 13 out).
            meta: [totalSlots
              ? t('tournament.hero_pairs_of', { n: teamsIn ?? tour.entry_count ?? 0, total: totalSlots })
              : t('tournament.hero_pairs', { count: teamsIn ?? tour.entry_count ?? 0 }),
            // As por validar à parte (a conta grande são os lugares): «0/16
            // DUPLAS · 1 POR VALIDAR» (UX, 14 out). Só a quem organiza: é
            // informação dele, não de quem vê o torneio (PO/UX, 18 out).
            isAdmin && pendingPairs > 0 ? t('tournament.hero_pending', { count: pendingPairs }) : null,
            isToday ? t('ui.today') : null].filter(Boolean).join(' · '),
          }}
        >
          {/* Terminado ou cancelado, os botões da inscrição saem (UX, 13 out). */}
          {UnderHeader && !ended && !cancelled && <Suspense fallback={null}><UnderHeader {...panelProps} withInfo={false} /></Suspense>}
        </EventHero>
        {/* O que ficou por gravar ao criar (preço especial, 10 out). */}
        {location.state?.notice && (
          <p role="alert" className="rounded-ctrl bg-danger/10 p-3.5 text-sm font-extrabold text-danger">{location.state.notice}</p>
        )}

        {/* A faixa do modo público é a ÚNICA coisa que um visitante a sério não
            vê. Em rascunho diz a verdade em vez de dar a entender que já está
            no ar. Sai com um toque, e o botão de trás do telemóvel também sai
            do modo em vez de sair da página. */}
        {publicView && canManage && (
          <div className="card">
            <p className="flex items-start gap-2 text-sm text-ink-700">
              <Eye size={15} className="mt-0.5 shrink-0" />
              {tour.status === 'rascunho'
                ? t('tournament.admin.public_view_draft')
                : t('tournament.admin.public_view')}
            </p>
            <button type="button" onClick={() => navigate(-1)}
              className="btn-secondary mt-3 w-full">
              {t('tournament.admin.back_to_admin')}
            </button>
          </div>
        )}

        {isAdmin && adminError && <p className="text-sm text-danger">{adminError}</p>}

        {/* Aviso do organizador — acima de tudo, e só quando há aviso. */}
        {TopSlot && <Suspense fallback={null}><TopSlot {...panelProps} /></Suspense>}

        <EventFacts items={heroFacts} />

        {/* Com o sorteio feito, o terminar de cada categoria (o passo seguinte
            de quem organiza foi para o topo, UX 13 out). */}
        {isAdmin && (
          <AdminBar
            part="live"
            tournament={tour}
            categories={categories}
            onChanged={() => window.dispatchEvent(new Event('tournament:reload'))}
            onDraw={() => openAdmin('sorteio')}
          />
        )}

        {/* Campeões da categoria, quando termina (peça 2, 28 set). */}
        <ChampionsBlock tournament={tour} category={category} isAdmin={isAdmin} />

        {/* «O teu próximo jogo»: um cartão com o jogo à vista, no lugar do lima
            que só mudava o separador lá em baixo (Francisco, 1 out). Sem mais
            jogos, sai. */}
        {hasGames && !publicView && tour.status !== 'cancelado' && (
          <NextGameCard game={myGame} onOpenList={() => {
            setParam('tab', 'my_games')
            // Desce até lá: sem isto não se via nada a mudar (Francisco, 1 out).
            // A lista carrega aos bocados (o painel é preguiçoso e lê o quadro):
            // uma descida suave ficava a meio (~117 px, QA 2 out). Desce de uma
            // vez e repete até a posição assentar.
            let tries = 0
            let last = null
            const settle = () => {
              const el = document.getElementById('tournament-tabs')
              if (el) {
                el.scrollIntoView({ block: 'start' })
                const top = Math.round(el.getBoundingClientRect().top)
                if (top === last) return
                last = top
              }
              if (++tries < 20) setTimeout(settle, 150)
            }
            setTimeout(settle, 50)
          }} />
        )}

        {/* O cartaz do torneio (categorias, pagamento, mapa, quem organiza),
            depois dos quadrados de dados (R3, 13 out). */}
        <PublicInfo plain tournament={tour} categories={categories} entriesOpen={categories.some((c) => entriesOpen(tour, c))} />
      </div>

      {/* A categoria e os separadores ficam presos por baixo do título ao
          descer (Francisco, 11 out, para experimentar — StickyBar). */}
      <div id="tournament-tabs" className="scroll-mt-20" />
      <StickyTabs resetKey={`${category?.id || ''}:${tab}`} pullKey={pullKey} shadow={tab !== 'schedule'} belowBackBar={false} glass>
      {/* No Horário com várias categorias, a escolha é a linha de pastilhas
          «Todas · M4 · F5…» dentro do painel (UX, 22 out). */}
      {categories.length > 0 && !(tab === 'schedule' && categories.length > 1) && (
        <CategorySelect
          categories={categories}
          mineId={activeMy(data)?.category_id}
          value={category?.id}
          onChange={(nextId) => { setParam('cat', categories.find((c) => c.id === nextId)?.code || ''); setPullKey((k) => k + 1) }}
          label={t('tournament.category_select_label')}
        />
      )}

      {/* O separador único da app (Trello #528): muda o que o ecrã mostra,
          por isso é pílula cinzenta — não pastilhas pretas, que são filtro. */}
      <Tabs
        options={tabs.map((key) => ({ value: key, label: t(`tournament.tab_${key}`) }))}
        value={tab}
        onChange={(next) => { setParam('tab', next); setPullKey((k) => k + 1) }}
        label={t('tournament.tabs_label')}
      />
      </StickyTabs>

      {/* Pelo menos um ecrã de altura por baixo da barra: assim, ao tocar
          num separador com pouco conteúdo, a barra ainda consegue subir até
          ficar presa em cima (Francisco, 14 out). */}
      <div style={{ minHeight: 'calc(100dvh - var(--t-sticky-bottom, 12rem) - 7rem)' }}>
        {/* O pódio vive DENTRO de «Os meus jogos», em cima — é onde o desenho
            de 23 set o põe. Estava acima dos separadores desde ontem; foi
            engano meu. Ele próprio só aparece com o torneio terminado.
            Sem inscrição não há «Os meus jogos»: vai para o primeiro
            separador, «Todos os jogos» (28 set). */}
        {/* O pódio antigo deu lugar aos «Campeões» no topo (28 set); fica o
            que a pessoa levou do torneio, em «Os meus jogos». */}
        {tab === 'my_games' && Podium && (
          <div className="mb-4"><Suspense fallback={null}><Podium {...panelProps} /></Suspense></div>
        )}
        {Panel ? (
          <Suspense fallback={spinner}><Panel {...panelProps} /></Suspense>
        ) : (
          <div className="rounded-card border border-dashed border-line px-4 py-8 text-center">
            <MonoLabel>{TOURNAMENT_TAB_OWNER[tab]}</MonoLabel>
            <p className="mt-1.5 text-sm text-ink-500">{t('tournament.tab_not_built')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
