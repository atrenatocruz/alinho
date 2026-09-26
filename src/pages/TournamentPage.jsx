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
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Eye, Trophy } from 'lucide-react'
import { useGoBack } from '../lib/useGoBack'
import { useAuth } from '../contexts/AuthContext'
import { getTournamentForEdit, getTournamentPage, updateTournament } from '../lib/tournamentApi'
import { describeError, errorKind } from '../lib/errors'
import { Avatar, EmptyState, Tabs } from '../components/ui'
import { CategorySelect, LILAC, MonoLabel, StatePill, TourTag } from '../components/tournament/TournamentBits'
import { TOURNAMENT_PANELS, TOURNAMENT_TABS, TOURNAMENT_TAB_OWNER } from '../components/tournament/panels'
import AdminBar from '../components/tournament/AdminBar'
import CreateTournamentForm from '../components/tournament/CreateTournamentForm'
import DrawAdminPanel from '../components/tournament/DrawAdminPanel'
import TournamentCalendarGrid from '../components/tournament/TournamentCalendarGrid'
import { drawProgress, statusKey } from '../components/tournament/drawProgress'

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

// As minhas inscrições ativas. Uma desistida não conta — nem antes de a
// base de dados deixar de a devolver (migration_tournaments_withdraw_resignup,
// Trello #451). Sem `my_entries` (migração por correr), vale o `my`.
const activeEntries = (data) =>
  (data?.my_entries || (data?.my ? [{ ...data.my, status: data.my.state }] : []))
    .filter((e) => (e.status ?? e.state) !== 'desistiu')
const activeMy = (data) => activeEntries(data)[0] || null

const STATE_PILL = {
  inscricoes: 'grey',
  fechado: 'grey',
  sorteado: 'dark',
  a_decorrer: 'live',
  terminado: 'grey',
}

export default function TournamentPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const goBack = useGoBack('/')
  const navigate = useNavigate()
  const { memberships } = useAuth()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
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

  const categories = data?.categories || []
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
  const LEGACY_TABS = { groups: 'all_games', draw: 'all_games', calendar: 'all_games' }
  const tab = TOURNAMENT_TABS.includes(tabParam) ? tabParam : (LEGACY_TABS[tabParam] || 'my_games')

  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    next.set(key, value)
    setParams(next, { replace: true, state: { keepScroll: true } })
  }

  const back = (
    <button type="button" onClick={goBack} className="inline-flex min-h-[44px] items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
      <ArrowLeft size={16} /> {t('common.back')}
    </button>
  )

  if (failed) {
    return (
      <div className="space-y-5">
        {back}
        <EmptyState icon={Trophy} title={t('tournament.not_found_title')} subtitle={t('tournament.not_found_subtitle')} />
      </div>
    )
  }
  if (!data) {
    return <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div></div>
  }

  const tour = data.tournament
  // «Ver como quem chega de fora»: a MESMA página com `?ver=publico`, nunca
  // outro separador do browser — quem usa isto está no clube, de telemóvel,
  // a conferir como o link aparece a quem o recebe. Some a barra de admin e
  // fica tudo o resto, INCLUSIVE o botão de inscrever: se estiver partido é
  // isso mesmo que o admin precisa de ver.
  const publicView = params.get('ver') === 'publico'
  const adminMode = params.get('admin')   // 'editar' | 'sorteio' | 'horario'
  const canManage = !!memberships?.find((m) => m.organization_id === tour.organization_id)?.is_admin
  const isAdmin = canManage && !publicView
  const Panel = TOURNAMENT_PANELS[tab]
  const TopSlot = TOURNAMENT_PANELS.top
  const UnderHeader = TOURNAMENT_PANELS.under_header
  const Podium = TOURNAMENT_PANELS.podium
  const panelProps = {
    tournament: tour,
    categories,
    category,
    my: activeMy(data),
    myEntries: activeEntries(data),
    myMatches: data.my_matches || [],
  }
  const clubForForm = { id: tour.organization_id, name: tour.club_name, location: tour.location }

  const openAdmin = async (modo) => {
    setAdminError('')
    const next = new URLSearchParams(params); next.set('admin', modo); setParams(next)
    if (modo !== 'editar') return
    try {
      const d = await getTournamentForEdit(tour.id)
      if (!d?.tournament) throw new Error('not ready')
      setEditing(d)
    } catch (err) {
      if (errorKind(err) !== 'not_ready') console.error('Error loading tournament:', err)
      setAdminError(describeError(t, err, 'tournament.admin.edit_error'))
    }
  }

  const closeAdmin = () => {
    const next = new URLSearchParams(params); next.delete('admin'); setParams(next)
    setEditing(null); setAdminError('')
  }

  const saveEdit = async (draft) => {
    setSavingEdit(true); setAdminError('')
    try {
      await updateTournament(tour.id, draft)
      closeAdmin()
      window.dispatchEvent(new Event('tournament:reload'))
    } catch (err) {
      setAdminError(describeError(t, err))
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
  if (isAdmin && adminMode === 'editar' && editing) {
    return (
      <div className="space-y-4">
        <CreateTournamentForm
          club={clubForForm}
          initial={editing}
          locked={!!editing.has_entries}
          saving={savingEdit}
          error={adminError}
          onCancel={closeAdmin}
          onCreate={saveEdit}
        />
      </div>
    )
  }

  const spinner = <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700" /></div>

  return (
    <div className="space-y-4">
      {back}

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

      {isAdmin && (
        <>
          <AdminBar
            tournament={tour}
            categories={categories}
            onChanged={() => window.dispatchEvent(new Event('tournament:reload'))}
            onEdit={() => openAdmin('editar')}
            onDraw={() => openAdmin('sorteio')}
            onSchedule={() => openAdmin('horario')}
          />
          {adminError && <p className="text-sm text-danger">{adminError}</p>}
        </>
      )}

      {/* Aviso do organizador — acima de tudo, e só quando há aviso. */}
      {TopSlot && <Suspense fallback={null}><TopSlot {...panelProps} /></Suspense>}

      {/* Topo = cartão em grande, como nos mixes. O cartaz, quando o clube
          o carrega, entra por cima — é a primeira coisa de quem chega pelo
          WhatsApp (print 07, passo 1). */}
      <div className="overflow-hidden rounded-card border" style={{ background: LILAC.bg, borderColor: LILAC.border }}>
        {tour.poster_url && (
          <img src={tour.poster_url} alt={tour.name} className="block max-h-56 w-full object-cover" />
        )}
        {/* Como o topo da página do mix: p-4 e o título grande (revisão
            da designer de 26 set). */}
        <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <TourTag>{t('tournament.label')}</TourTag>
          {['validada', 'selecionada'].includes(activeMy(data)?.state)
            ? <StatePill tone="in">{t('tournament.state_entered')}</StatePill>
            : <StatePill tone={STATE_PILL[tour.status] || 'grey'}>{t(statusKey(tour.status, drawProgress(categories)), drawProgress(categories))}</StatePill>}
        </div>
        <h1 className="mt-2.5 font-display text-2xl leading-tight text-ink-900">{tour.name}</h1>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
          <Avatar name={tour.club_name} url={tour.club_logo_url} size="w-[18px] h-[18px] text-[8px]" />
          <span className="min-w-0 truncate">
            {[tour.club_name, dateRange(tour.starts_on, tour.ends_on, i18n.language), tour.court_count ? t('tournament.courts', { count: tour.court_count }) : null]
              .filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1 text-center text-xs text-ink-500">
          {[
            [tour.category_count, t('tournament.kv_categories')],
            [tour.entry_count, t('tournament.kv_teams')],
            [tour.match_count, t('tournament.kv_matches')],
            [tour.day_count, t('tournament.kv_days')],
          ].map(([value, label]) => (
            <div key={label}>
              <b className="block font-display text-lg font-extrabold text-ink-900">{value ?? 0}</b>
              {label}
            </div>
          ))}
        </div>
        </div>
      </div>

      {UnderHeader && <Suspense fallback={null}><UnderHeader {...panelProps} /></Suspense>}

      {categories.length > 0 && (
        <CategorySelect
          categories={categories}
          mineId={activeMy(data)?.category_id}
          value={category?.id}
          onChange={(nextId) => setParam('cat', categories.find((c) => c.id === nextId)?.code || '')}
          label={t('tournament.category_select_label')}
        />
      )}

      {/* O separador único da app (Trello #528): muda o que o ecrã mostra,
          por isso é pílula cinzenta — não pastilhas pretas, que são filtro. */}
      <Tabs
        options={TOURNAMENT_TABS.map((key) => ({ value: key, label: t(`tournament.tab_${key}`) }))}
        value={tab}
        onChange={(next) => setParam('tab', next)}
        label={t('tournament.tabs_label')}
      />

      <div>
        {/* O pódio vive DENTRO de «Os meus jogos», em cima — é onde o desenho
            de 23 set o põe. Estava acima dos separadores desde ontem; foi
            engano meu. Ele próprio só aparece com o torneio terminado. */}
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
