import { Fragment, useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Clock, Check, Plus, ChevronRight, ChevronDown, MapPin, Search } from 'lucide-react'
import { searchOrganizations, listGlobalOrganizations } from '../lib/organizations'
import { DAYS, listTeachersPublic, teacherClubName } from '../lib/teachers'
import { scheduleFromRows, shortRange } from '../lib/teacherSchedule'
import { teacherContact } from '../lib/teacherContact'
import { LevelPill, bandLabel } from '../components/lessons/LessonBits'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { followPlayer, removeFollow } from '../lib/follows'
import { Avatar, ConfirmSheet, EmptyState, TOP_EDGE, StickyTop, FilterBar } from '../components/ui'
import { SAFE_TOP } from '../components/GlassBar'
import { Sheet } from '../components/agenda/AgendaControls'
import Alino from '../components/Alino'
import ClubSeal from '../components/club/ClubSeal'
import { DISTRICTS } from '../lib/leagueDistricts'
import { describeError } from '../lib/errors'
import { useHeaderActions } from '../contexts/HeaderActionsContext'
import { semAcentos } from '../lib/semAcentos'
import KindHero from '../components/KindHero'
import { KIND_COLORS } from '../lib/kindColors'
import { coverOf, useOrgCovers } from '../lib/orgCover'
import { Realce } from '../components/SearchField'
import { placeName } from '../lib/placeName'
import { SkeletonGate, SkBlock, SkLine, SkRow } from '../components/Skeleton'

/* ─── Comunidade (épico «Comunidade vs. Rankings», Trello #271/#273) ─────────
   Encontrar clubes, grupos e professores — e só isso. Desenho:
   https://claude.ai/artifact/LmwwNPxxnNRttG1RbHdDCt
   - Sem abas: uma pesquisa + filtros em pastilhas (mesma lógica da Home).
   - Os teus primeiro. Jogadores saíram daqui: procuram-se nos Rankings.
   - Um cartão por clube/grupo: logótipo em cima (quadrado = clube, redondo =
     grupo), dados, e um só botão em baixo. Sair e favorito vivem na página
     do clube.
   - "O meu grupo" e "Criar grupo" estão no Gerir; "Quero dar aulas" no
     Perfil.
   - Ainda não: "Perto de mim" (depende da localização da Home) e seguir sem
     ser membro (#277) — até lá "Que sigo" = onde és membro ou pediste para
     entrar. */

/* Três separadores, desde 23 set (desenho `design-handoff/2026-09-23-pagina-do-grupo/`).
   Eram cinco pastilhas — Tudo · Clubes · Grupos · Professores · Os meus —
   por cima de seis linhas. Um filtro que devolve uma linha é pior do que não
   haver filtro: ensina à pessoa que a app está vazia.

   E faltava o principal: a Comunidade respondia a «que organizações existem
   na Alinho?», que não é a pergunta de ninguém. A pergunta é «onde é que eu
   posso jogar?» — e um torneio aberto é a única coisa na app a que alguém de
   fora chega sem pedir licença a ninguém.

   «Os meus» deixa de ser filtro: onde a pessoa já está é o que ela quer ver
   primeiro, não o que ela quer filtrar. Sobe na lista.

   Os três existem SEMPRE, mesmo vazios — um separador que aparece e some
   conforme os dados muda a navegação debaixo dos pés de quem a usa.

   24 set: o «Para jogar» saiu (Francisco: «Comunidade apenas mostra clubes,
   grupos e professores. Mais nada. A Home é que mostra o que há para
   jogar.»). Os torneios abertos continuam na Home. E passam a filtros:
   Todos · Clubes · Grupos · Professores (Francisco, 24 set: «Quero poder ver
   todos ou a cada um em separado. Tipo filtros.»), com as mesmas pastilhas
   dos filtros da Home. */
// Os pontos de cor nas pastilhas (UX, 13 out): clubes a preto, grupos no
// cinzento-escuro dos amigos e professores no verde das aulas.
// «A seguir» (Comunidade nova, 18 out): pastilha solta, sem ponto, logo a
// seguir a «Todos». Mostra só os clubes e grupos de que a pessoa é membro.
const TABS = [
  { key: 'all', labelKey: 'comunidade.filter_all' },
  { key: 'following', labelKey: 'comunidade.following_label' },
  { key: 'clubs', labelKey: 'comunidade.filter_clubs', dot: '#040404' },
  { key: 'groups', labelKey: 'comunidade.filter_groups', dot: KIND_COLORS.friends.strong },
  { key: 'teachers', labelKey: 'comunidade.tab_teachers', dot: KIND_COLORS.lesson.strong },
]

// A mesma regra de todas as pesquisas de nomes (src/lib/semAcentos.js).
const norm = semAcentos
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'pt')
// Dentro de cada secção: os maiores primeiro (até haver distância, Fase 2).
const bySize = (a, b) => (b.member_count ?? -1) - (a.member_count ?? -1) || byName(a, b)

// O que o clube organiza, com o ponto da cor de cada tipo (organizes, da
// lista da Comunidade; Dev 3, migration_comunidade_lista_colunas.sql).
const ORGANIZES = [
  { key: 'mix', labelKey: 'agenda.filter_kind_mix', color: KIND_COLORS.mix.strong },
  { key: 'tournament', labelKey: 'agenda.filter_kind_tournament', color: KIND_COLORS.tournament.strong },
  { key: 'open_game', labelKey: 'agenda.filter_kind_open', color: KIND_COLORS.open.strong },
  { key: 'lesson', labelKey: 'agenda.filter_kind_lesson', color: KIND_COLORS.lesson.strong },
]

// A zona escolhida fica neste telemóvel, como a localização da Home.
const ZONE_KEY = 'alinho.comunidade.zona'
const readZone = () => {
  try {
    const z = localStorage.getItem(ZONE_KEY)
    return DISTRICTS.includes(z) ? z : null
  } catch { return null }
}
const writeZone = (z) => {
  try { localStorage.setItem(ZONE_KEY, z) } catch { /* modo privado: fica só nesta visita */ }
}
// «Continuar» do «Para começares» fecha-o até a pessoa voltar a abrir a app.
const START_KEY = 'alinho.comunidade.comecar'
const startDismissed = () => { try { return sessionStorage.getItem(START_KEY) === '1' } catch { return false } }

const monoHeading = 'mb-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[.1em] text-[#4F535A]'


// Um cartão de clube a cinzento, com a forma do verdadeiro: capa, logótipo,
// nome, linha pequena e o botão de baixo.
function OrgCardSkeleton() {
  return (
    <div aria-hidden className="overflow-hidden rounded-[22px] bg-white shadow-card">
      <SkBlock h={120} rounded="rounded-none" />
      <div className="px-3.5 pb-3.5">
        <span className="relative -mt-[30px] inline-block rounded-[15px] bg-white p-[3px]">
          <span className="sk relative block h-[52px] w-[52px] overflow-hidden rounded-[12px] bg-[#ECECE7]" />
        </span>
        <SkLine size="title" w="62%" className="mt-1.5" />
        <SkLine size="text" w="44%" className="mt-2" />
        <SkBlock h={40} rounded="rounded-[12px]" className="mt-2.5" />
      </div>
    </div>
  )
}

// A escolha da zona (folha branca, com pesquisa): os 20 distritos.
function ZoneSheet({ zone, onPick, onClose }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const shown = DISTRICTS.filter((d) => norm(d).includes(norm(q.trim())))
  return (
    <Sheet title={t('comunidade.zone_title')} onClose={onClose}>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('comunidade.zone_search')}
          aria-label={t('comunidade.zone_search')}
          className="min-h-[48px] w-full rounded-ctrl border border-line bg-canvas pl-10 pr-3 text-base text-ink-900" />
      </div>
      <ul className="mt-2">
        {shown.map((d) => (
          <li key={d}>
            <button type="button" onClick={() => onPick(d)}
              className="flex min-h-[48px] w-full items-center justify-between border-b border-[#EEF0EA] text-left text-base font-semibold text-ink-900">
              {d}
              {d === zone && <Check size={18} className="text-ink-900" />}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

export default function Comunidade() {
  const { t, i18n } = useTranslation()
  const headerActions = useHeaderActions()
  const { user, memberships, followOrganization } = useAuth()
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [organizations, setOrganizations] = useState([])
  const [loading, setLoading] = useState(true)
  const [actingOn, setActingOn] = useState(null)
  const timeoutRef = useRef(null)
  // A zona da pessoa (Comunidade nova, 18 out: «perto de ti» = no teu
  // distrito). A escolhida neste telemóvel; senão, a zona do mês; senão, o
  // distrito dos clubes e grupos que segue.
  const [zone, setZone] = useState(readZone)
  const [autoZone, setAutoZone] = useState(null)
  const [zoneOpen, setZoneOpen] = useState(false)

  const [teachers, setTeachers] = useState([])
  // As capas escolhidas no Gerir (as listas da Comunidade não as trazem).
  const covers = useOrgCovers(organizations.map((o) => o.id))
  const [teachersLoading, setTeachersLoading] = useState(true)
  const trimmed = query.trim()

  const reloadOrganizations = async () => {
    try {
      setOrganizations(trimmed.length > 1 ? await searchOrganizations(trimmed) : await listGlobalOrganizations())
    } catch (error) {
      console.error('Error reloading organizations:', error)
    }
  }

  useEffect(() => {
    // 1 letra: nem pesquisa nem lista vazia — deixa ficar o que está.
    if (trimmed.length === 1) return
    setLoading(true)
    if (trimmed.length === 0) {
      listGlobalOrganizations()
        .then(setOrganizations)
        .catch((error) => console.error('Error loading comunidade:', error))
        .finally(() => setLoading(false))
      return
    }
    timeoutRef.current = setTimeout(async () => {
      try {
        setOrganizations(await searchOrganizations(trimmed))
      } catch (error) {
        console.error('Error searching comunidade:', error)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timeoutRef.current)
  }, [trimmed])

  const loadTeachers = async () => {
    setTeachersLoading(true)
    try {
      setTeachers(await listTeachersPublic())
    } catch (error) {
      console.error('Error loading teacher profiles:', error)
    } finally {
      setTeachersLoading(false)
    }
  }

  useEffect(() => {
    loadTeachers()
  }, [])

  // ── Professores ────────────────────────────────────────────────────────
  const approvedTeachers = teachers
    .filter((teacher) => teacher.user_id !== user.id && teacher.status === 'approved')
    .filter((teacher) => trimmed.length < 2
      || norm(teacher.user?.name).includes(norm(trimmed))
      || norm(teacherClubName(teacher)).includes(norm(trimmed))
      || norm(teacher.zone).includes(norm(trimmed)))

  // ── Clubes e grupos ────────────────────────────────────────────────────
  // Os meus vêm das memberships (incluem os que não aparecem na pesquisa);
  // quando o diretório os traz, usa-se essa linha, que tem nº de membros.
  const directoryById = useMemo(() => new Map(organizations.map((o) => [o.id, o])), [organizations])
  const myOrgs = useMemo(() => memberships
    .map((m) => m.organization)
    .filter(Boolean)
    .map((o) => ({ ...o, ...(directoryById.get(o.id) || {}), my_status: 'member' }))
    .sort(byName), [memberships, directoryById])
  const myOrgIds = new Set(myOrgs.map((o) => o.id))

  // Sem zona escolhida: a zona do mês (get_my_month_zone) e, sem ela, o
  // distrito mais comum dos clubes e grupos que segue.
  const myOrgsZone = useMemo(() => {
    const n = {}
    myOrgs.forEach((o) => { if (DISTRICTS.includes(o.district)) n[o.district] = (n[o.district] || 0) + 1 })
    return Object.keys(n).sort((x, y) => n[y] - n[x])[0] || null
  }, [myOrgs])
  useEffect(() => {
    if (zone) return undefined
    let alive = true
    supabase.rpc('get_my_month_zone').then(({ data, error }) => {
      if (!alive || error) return
      if (DISTRICTS.includes(data?.district)) setAutoZone(data.district)
    })
    return () => { alive = false }
  }, [zone])
  const myZone = zone || autoZone || myOrgsZone
  // Enquanto a lista não trouxer o distrito de ninguém (antes da migração do
  // Dev 3), não há «perto de ti»: nem a zona em cima, nem as secções.
  const hasZones = organizations.some((o) => o.district)
  const nearZone = hasZones ? myZone : null

  const matchesQuery = (o) => trimmed.length < 2 || norm(o.name).includes(norm(trimmed))
  const statusOf = (org) => (myOrgIds.has(org.id) ? 'member' : org.my_status)

  // Todos os clubes e grupos numa lista: os da lista da Comunidade e os
  // meus que lá não estão (um grupo privado onde já estou).
  const allOrgs = [...organizations, ...myOrgs.filter((o) => !directoryById.has(o.id))]
  const searching = trimmed.length > 1
  const verTudo = tab === 'all' || searching
  const showTeachers = tab === 'teachers' || verTudo
  const showOrgs = tab !== 'teachers' || searching
  const shownOrgs = allOrgs.filter(matchesQuery).filter((o) => (
    searching || tab === 'all' ? true
      : tab === 'following' ? statusOf(o) === 'member'
        : (o.kind === 'group') === (tab === 'groups')
  ))
  const ordered = (list) => [...list].sort((a, b) => (statusOf(b) === 'member') - (statusOf(a) === 'member') || bySize(a, b))
  const clubsFirst = (list) => [...ordered(list.filter((o) => o.kind !== 'group')), ...ordered(list.filter((o) => o.kind === 'group'))]
  // As secções (SPEC, ponto 3): «Clubes perto de ti», «Grupos perto de ti»
  // e «Mais longe»; no fim, «Outros clubes e grupos», os que não têm distrito
  // (UX, 7 nov). Sem zona: «Clubes» e «Grupos». A pesquisa é uma lista só.
  const sections = (() => {
    if (searching) return [{ key: 'results', title: t('comunidade.results_count', { count: shownOrgs.length + (showTeachers ? approvedTeachers.length : 0) }), orgs: clubsFirst(shownOrgs), counted: true }]
    const near = nearZone ? shownOrgs.filter((o) => o.district === nearZone) : shownOrgs
    const far = nearZone ? shownOrgs.filter((o) => o.district && o.district !== nearZone) : []
    const other = nearZone ? shownOrgs.filter((o) => !o.district) : []
    return [
      { key: 'clubs', title: t(nearZone ? 'comunidade.clubs_near' : 'comunidade.filter_clubs'), orgs: ordered(near.filter((o) => o.kind !== 'group')) },
      { key: 'groups', title: t(nearZone ? 'comunidade.groups_near' : 'comunidade.filter_groups'), orgs: ordered(near.filter((o) => o.kind === 'group')) },
      { key: 'far', title: t('comunidade.further'), orgs: clubsFirst(far) },
      { key: 'other', title: t('comunidade.other_orgs'), orgs: clubsFirst(other) },
    ].filter((sec) => sec.orgs.length > 0)
  })()
  // Só um lima por ecrã: o «Seguir» lima só no primeiro que se segue sem
  // pedir. Nos outros fica em contorno.
  const joinsDirectly = (org) => org.open_join && !org.parent_organization_id
  const limaId = sections.flatMap((sec) => sec.orgs).find((o) => !statusOf(o) || statusOf(o) === 'none' ? joinsDirectly(o) : false)?.id

  // «Para começares» (SPEC, ponto 7): quem ainda não segue nenhum clube nem
  // grupo. Fica aberto nesta visita até «Continuar», mesmo depois de seguir
  // o primeiro (para se ver o «✓ A seguir» na lista).
  const [startOpen, setStartOpen] = useState(null)
  useEffect(() => {
    if (startOpen !== null || loading) return
    setStartOpen(myOrgs.length === 0 && !startDismissed())
  }, [loading, myOrgs.length, startOpen])
  const closeStart = () => {
    try { sessionStorage.setItem(START_KEY, '1') } catch { /* modo privado */ }
    setStartOpen(false)
  }
  const startList = useMemo(() => {
    const pool = [...organizations]
    const inZone = (o) => (nearZone && o.district === nearZone ? 0 : 1)
    return pool.sort((a, b) => inZone(a) - inZone(b) || (a.kind === 'group') - (b.kind === 'group') || bySize(a, b)).slice(0, 5)
  }, [organizations, nearZone])
  const showStart = startOpen && tab === 'all' && !searching

  // Quem eu sigo (e pedidos meus por aceitar), para o botão de cada
  // professor dizer o estado certo. As minhas linhas vejo-as sempre (RLS).
  const [myFollows, setMyFollows] = useState({})
  const [followActing, setFollowActing] = useState(null)
  useEffect(() => {
    if (!user?.id) return
    supabase.from('follows').select('id, followed_id, status').eq('follower_id', user.id)
      .then(({ data, error }) => {
        if (error) { console.error('Error loading follows:', error); return }
        setMyFollows(Object.fromEntries((data || []).map((f) => [f.followed_id, f])))
      })
  }, [user?.id])

  // Erros no cartão, nada de alert()/confirm() (desenho aprovado 25 set,
  // professores, assunto 3; regra das janelas).
  const [cardError, setCardError] = useState({}) // { [id]: texto }
  const [askUnfollow, setAskUnfollow] = useState(null) // professor
  const setErr = (id, text) => setCardError((m) => ({ ...m, [id]: text }))

  const handleTeacherFollow = async (teacher) => {
    setFollowActing(teacher.user_id); setErr(teacher.id, '')
    try {
      const status = await followPlayer(teacher.user_id)
      const { data } = await supabase.from('follows').select('id, followed_id, status')
        .eq('follower_id', user.id).eq('followed_id', teacher.user_id)
      setMyFollows((m) => ({ ...m, [teacher.user_id]: data?.[0] || { status } }))
    } catch (error) {
      console.error('Error following teacher:', error)
      setErr(teacher.id, describeError(t, error, 'comunidade.follow_failed'))
    } finally {
      setFollowActing(null)
    }
  }

  // Deixar de seguir pergunta antes (janela de baixo); cancelar um pedido não.
  const handleTeacherUnfollow = async (teacher) => {
    const follow = myFollows[teacher.user_id]
    if (!follow?.id) return
    setFollowActing(teacher.user_id); setErr(teacher.id, '')
    try {
      await removeFollow(follow.id)
      setMyFollows((m) => { const n = { ...m }; delete n[teacher.user_id]; return n })
    } catch (error) {
      console.error('Error unfollowing teacher:', error)
      setErr(teacher.id, t('comunidade.unfollow_failed_card'))
    } finally {
      setFollowActing(null)
    }
  }

  const handleFollow = async (org) => {
    setActingOn(org.id); setErr(org.id, '')
    try {
      const { error } = await followOrganization(org.id)
      if (error) throw error
      await reloadOrganizations()
    } catch (error) {
      console.error('Error following organization:', error)
      setErr(org.id, describeError(t, error, 'comunidade.follow_failed'))
    } finally {
      setActingOn(null)
    }
  }

  // ── Cartões de clube e de grupo (Comunidade nova, 18 out) ──────────────
  // design-handoff/2026-10-18-comunidade-clubes-destaque: o aspeto do
  // clube é o da proposta v2 e o resto o da v3.
  // O estado: «✓ A seguir», «Pedido enviado», «Seguir» ou «Pedir para
  // seguir» (BA, 18 out: seguir = ser membro; só muda o texto).
  const renderState = (org) => {
    const status = statusOf(org)
    if (status === 'member') {
      return (
        <span className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-[12px] bg-[#F4F8DC] py-2.5 font-display text-[14px] font-extrabold leading-none text-[#3F6212]">
          <Check size={15} /> {t('clubprofile.is_member')}
        </span>
      )
    }
    if (status === 'pending') {
      return (
        <span className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-[12px] bg-[#F4F5F1] py-2.5 font-display text-[14px] font-extrabold leading-none text-ink-500">
          <Clock size={15} /> {t('comunidade.request_sent')}
        </span>
      )
    }
    const lima = org.id === limaId
    return (
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); handleFollow(org) }}
        disabled={actingOn === org.id}
        className={`flex min-h-[44px] w-full items-center justify-center rounded-[12px] font-display text-[14px] font-extrabold text-ink-900 transition-colors duration-fast disabled:opacity-40 ${
          lima ? 'bg-lime-400 hover:bg-lime-600' : 'border-[1.5px] border-[#CFD2D7] bg-white hover:bg-ink-50'
        }`}
      >
        {joinsDirectly(org) ? t('comunidade.join_action') : t('comunidade.request_entry_action')}
      </button>
    )
  }

  // «Sítio · N membros» (#787): o sítio é a localidade, nunca a morada
  // inteira, e é a única parte que encolhe; os membros nunca são cortados.
  const subOf = (org) => {
    const group = org.kind === 'group'
    const place = group ? (org.parent_name ? t('comunidade.group_of', { club: org.parent_name }) : t('comunidade.group_community')) : placeName(org.location, org.district)
    const members = org.member_count != null ? t('comunidade.member_count', { count: org.member_count }) : null
    return (
      <span className="flex min-w-0">
        {place && <span className="min-w-0 truncate">{place}</span>}
        {members && <span className="shrink-0 whitespace-nowrap">{place && ' · '}{members}</span>}
      </span>
    )
  }
  // A frase não aparece quando é igual ao nome (o A2N tem «A2N Padel Academy»).
  const sameText = (a, b) => semAcentos(String(a || '')).trim().toLowerCase() === semAcentos(String(b || '')).trim().toLowerCase()

  const coverFor = (org) => coverOf(org, covers[org.id] || org.cover_url)

  const renderOrgCard = (org) => {
    const group = org.kind === 'group'
    // O selo: clube verificado (Dev 3, club_verified). Sem ele, o clube
    // aparece sem selo nem etiquetas.
    const verified = !group && org.club_verified === true
    const kinds = group ? [] : ORGANIZES.filter((k) => (org.organizes || []).includes(k.key))
    return (
      <Link key={org.id} to={`/clube/${org.slug}`} className="block overflow-hidden rounded-[22px] bg-white shadow-card card-open">
        {/* A capa: 120 px no clube, 84 px no grupo. */}
        <KindHero kind="club" src={coverFor(org)} className={group ? 'h-[84px]' : 'h-[120px]'} />
        <div className="px-3.5 pb-3.5">
          {/* O logótipo quadrado (clube, 58 px) ou o avatar redondo (grupo,
              54 px), a passar por cima da capa. */}
          {/* A mesma imagem da página do clube e do grupo (UX, 6 nov): o
              logótipo ou, sem ele, a inicial. */}
          {group ? (
            <span className="relative -mt-7 inline-block rounded-full bg-white p-[3px]">
              <Avatar name={org.name} url={org.group_logo_url} size="w-12 h-12 text-lg" shape="round" colorClass="bg-ink-900 text-lime-400" />
            </span>
          ) : (
            <span className="relative -mt-[30px] inline-block rounded-[15px] bg-white p-[3px]">
              <Avatar name={org.name} url={org.group_logo_url} size="w-[52px] h-[52px] text-xl" shape="square" colorClass="bg-ink-900 text-lime-400" />
            </span>
          )}
          {/* A parte encontrada a lima-claro (pesquisa, 14 out). */}
          <h3 className={`mt-1.5 flex items-center gap-1.5 font-display font-black leading-tight text-ink-900 [overflow-wrap:anywhere] ${group ? 'text-[17px]' : 'text-[19px]'}`}>
            <span className="min-w-0"><Realce text={org.name || ''} query={trimmed} /></span>
            {verified && <ClubSeal size={20} label={t('comunidade.verified')} />}
          </h3>
          {verified && (
            <div className="mt-[7px] flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F4F8DC] px-[9px] py-1 font-display text-[12px] font-extrabold text-[#3F6212]">
                <Check size={12} strokeWidth={3} /> {t('comunidade.verified')}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F4F5F1] px-[9px] py-1 font-display text-[12px] font-extrabold text-[#1F2937]">
                <MapPin size={12} /> {t('comunidade.physical')}
              </span>
            </div>
          )}
          {org.description && !sameText(org.description, org.name) && <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-[1.45] text-[#4B5563] [overflow-wrap:anywhere]">{org.description}</p>}
          <p className="mt-1.5 text-[13px] text-[#4B5563]">{subOf(org)}</p>
          {kinds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {kinds.map((k) => (
                <span key={k.key} className="inline-flex items-center gap-[5px] rounded-full bg-[#F4F5F1] px-2.5 py-1 font-display text-[12px] font-bold text-ink-900">
                  <i aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: k.color }} />{t(k.labelKey)}
                </span>
              ))}
            </div>
          )}
          <div className="mt-2.5">
            {renderState(org)}
            {cardError[org.id] && <p role="alert" className="mt-2 rounded-ctrl border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs font-bold text-danger">{cardError[org.id]}</p>}
          </div>
        </div>
      </Link>
    )
  }

  // «Para começares» (SPEC, ponto 7): o Alino olá, os 5 mais perto (os
  // clubes primeiro), cada um com «Seguir» (preto, compacto) ou «✓ A
  // seguir», e «Continuar» a lima.
  const renderStart = () => (
    <>
      <div className="flex items-center gap-3 rounded-[22px] bg-white p-4 shadow-card">
        <Alino pose="ola" size={64} className="!mx-0 shrink-0" />
        <div className="min-w-0">
          <p className="font-display text-[18px] font-black leading-tight text-ink-900">{t('comunidade.start_title')}</p>
          <p className="mt-0.5 text-[13.5px] leading-[1.45] text-[#4B5563]">{t('comunidade.start_text')}</p>
        </div>
      </div>
      {startList.length > 0 && (
        <ul className="overflow-hidden rounded-[20px] bg-white shadow-card">
          {startList.map((org) => {
            const group = org.kind === 'group'
            const status = statusOf(org)
            return (
              <li key={org.id} className="border-t border-[#EEF0EA] first:border-t-0">
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  <Link to={`/clube/${org.slug}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={org.name} url={org.group_logo_url} size="w-12 h-12 text-lg" shape={group ? 'round' : 'square'} colorClass="bg-ink-900 text-lime-400" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 font-display text-[15px] font-extrabold text-ink-900">
                        <span className="truncate">{org.name}</span>
                        {!group && org.club_verified === true && <ClubSeal size={15} label={t('comunidade.verified')} />}
                      </span>
                      {/* Nunca cortada: passa a duas linhas (UX, 6 nov). */}
                      <span className="line-clamp-2 block text-[12.5px] leading-snug text-[#4B5563]">
                        {[group && org.parent_name ? t('comunidade.group_of', { club: org.parent_name }) : t(group ? 'clubprofile.kind_group' : 'clubprofile.kind_club'),
                          org.member_count != null ? t('comunidade.member_count', { count: org.member_count }) : null].filter(Boolean)
                          .map((part, i) => <Fragment key={i}>{i > 0 && ' · '}<span className="whitespace-nowrap">{part}</span></Fragment>)}
                      </span>
                    </span>
                  </Link>
                  {status === 'member' ? (
                    <span className="inline-flex h-[34px] shrink-0 items-center gap-1 rounded-full bg-[#F4F8DC] px-3.5 font-display text-[13px] font-extrabold text-[#3F6212]">
                      <Check size={14} /> {t('clubprofile.is_member')}
                    </span>
                  ) : status === 'pending' ? (
                    <span className="inline-flex h-[34px] shrink-0 items-center gap-1 rounded-full bg-[#F4F5F1] px-3.5 font-display text-[13px] font-extrabold text-ink-500">
                      <Clock size={14} /> {t('comunidade.start_pending')}
                    </span>
                  ) : (
                    <button type="button" onClick={() => handleFollow(org)} disabled={actingOn === org.id}
                      className="inline-flex h-[34px] shrink-0 items-center rounded-full bg-ink-900 px-3.5 font-display text-[13px] font-extrabold text-white disabled:opacity-40">
                      {joinsDirectly(org) ? t('comunidade.join_action') : t('comunidade.start_request')}
                    </button>
                  )}
                </div>
                {cardError[org.id] && <p role="alert" className="mx-3.5 mb-2.5 rounded-ctrl border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs font-bold text-danger">{cardError[org.id]}</p>}
              </li>
            )
          })}
        </ul>
      )}
      <button type="button" onClick={closeStart}
        className="flex min-h-[48px] w-full items-center justify-center rounded-ctrl bg-lime-400 font-display text-base font-extrabold text-ink-900 hover:bg-lime-600">
        {t('comunidade.start_continue')}
      </button>
    </>
  )

  // Cartão do professor (desenho aprovado 25 set, pasta
  // 2026-09-25-professores-proposta, assunto 3): nome, «Professora/Professor
  // · clube · zona», nível e o resumo do horário (#418); a seta diz que o
  // cartão abre a página do professor. «Seguir» e o contacto com o nome do
  // que faz (WhatsApp, Email, Instagram).
  const renderTeacher = (teacher) => {
    const follow = teacher.user_id ? myFollows[teacher.user_id] : null
    const contact = teacherContact(teacher.contact)
    const female = teacher.user?.gender === 'feminino'
    const byDay = scheduleFromRows(teacher.availability || [])
    const slots = DAYS.flatMap(({ value }, i) => byDay[value].map((sl) =>
      `${t(`lessons.wd_short_${i + 1}`).replace(/^./, (c) => c.toUpperCase())} ${shortRange(sl.start, sl.end)}`))
    const level = bandLabel(teacher.user?.rating, teacher.user?.gender)
    const firstName = (teacher.user?.name || '').split(/\s+/)[0]
    const lesson = KIND_COLORS.lesson
    const btn = 'flex w-full min-h-[48px] items-center justify-center gap-1.5 rounded-ctrl text-base font-extrabold transition-colors duration-fast disabled:opacity-40'
    return (
      <div key={teacher.id} className="overflow-hidden rounded-[22px] bg-white shadow-card">
        {/* A faixa na cor das aulas (R0). */}
        <div className="px-4 py-2" style={{ background: lesson.strong }}>
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-white">{t(female ? 'comunidade.teacher_label_f' : 'comunidade.teacher_label')}</p>
        </div>
        <div className="space-y-3 p-4">
          {/* A página de professor só existe quando o clube já o aceitou
              (teacher_profile_active). Com o pedido ao clube por aceitar,
              o nome abre o perfil normal da pessoa (#550). */}
          <Link
            to={!teacher.organization_id || !teacher.club_status || teacher.club_status === 'accepted'
              ? `/professor/${teacher.id}`
              : `/jogador/${teacher.user_id}`}
            className="flex items-center gap-3"
          >
            <Avatar name={teacher.user?.name} url={teacher.user?.avatar_url} size="w-12 h-12 text-base" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-lg font-extrabold text-ink-900"><Realce text={teacher.user?.name || ''} query={trimmed} /></h3>
              <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
                <span className="truncate">{[teacherClubName(teacher) || t('comunidade.teacher_no_club_short'), teacher.zone].filter(Boolean).join(' · ')}</span>
                {level && <LevelPill label={level} />}
              </p>
            </div>
            <ChevronRight size={18} className="shrink-0 text-muted" />
          </Link>
          {slots.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {slots.map((sl) => (
                <span key={sl} className="rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ background: lesson.light, color: lesson.dark }}>{sl}</span>
              ))}
            </div>
          ) : <p className="text-sm text-muted">{t('comunidade.teacher_no_schedule')}</p>}
          {teacher.user_id && (
            follow?.status === 'accepted' ? (
              <button type="button" disabled={followActing === teacher.user_id}
                onClick={() => setAskUnfollow(teacher)}
                className={`${btn} border-[1.5px] border-line bg-white text-ink-900`}>
                <Check size={16} /> {t('playerdetails.following_button')}
              </button>
            ) : follow?.status === 'pending' ? (
              <button type="button" disabled={followActing === teacher.user_id}
                onClick={() => handleTeacherUnfollow(teacher)}
                className={`${btn} border-[1.5px] border-line bg-white text-muted`}>
                <Clock size={16} /> {t('playerdetails.requested_button')}
              </button>
            ) : (
              <button type="button" disabled={followActing === teacher.user_id}
                onClick={() => handleTeacherFollow(teacher)}
                className={`${btn} bg-ink-900 text-white`}>
                <Plus size={16} /> {t('playerdetails.follow_button')}
              </button>
            )
          )}
          {/* «Falar com <nome>» em texto, por baixo (nunca dois botões lado a lado). */}
          {contact && (
            <a href={contact.href} target="_blank" rel="noopener noreferrer"
              className="flex min-h-[44px] items-center justify-center text-sm font-extrabold text-ink-900 underline underline-offset-2">
              {t('comunidade.talk_to', { name: firstName })}
            </a>
          )}
          {cardError[teacher.id] && (
            <p role="alert" className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-bold text-danger">{cardError[teacher.id]}</p>
          )}
        </div>
      </div>
    )
  }

  const busy = loading || (showTeachers && teachersLoading)
  const orgsCount = sections.reduce((n, sec) => n + sec.orgs.length, 0)
  const nothing = !busy
    && (!showOrgs || orgsCount === 0)
    && (!showTeachers || approvedTeachers.length === 0)

  return (
    <div className="space-y-4">
      {/* O topo (v3): «Comunidade», o sino e, por baixo, «📍 <distrito> ⌄»,
          que abre a escolha da zona. O título sobe e sai; a barra fica presa
          em cima (R4, 13 out). */}
      <div className={`-mx-4 -mt-6 bg-white px-4 pb-3 ${TOP_EDGE}`} style={{ paddingTop: `calc(1rem + ${SAFE_TOP})` }}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-3xl text-ink-900">{t('comunidade.title')}</h2>
          {headerActions && <div className="flex shrink-0 items-center gap-1">{headerActions}</div>}
        </div>
        {hasZones && (
          <button type="button" onClick={() => setZoneOpen(true)} aria-label={t('comunidade.zone_aria')}
            className="mt-1 inline-flex max-w-full items-center gap-1 py-1 font-display text-[13.5px] font-extrabold leading-none text-[#1F2937]">
            <MapPin size={14} className="shrink-0" />
            <span className="truncate">{myZone || t('comunidade.zone_choose')}</span>
            <ChevronDown size={14} className="shrink-0" />
          </button>
        )}
      </div>

      {/* A barra da Home: 🔍 | Todos · A seguir · Clubes · Grupos ·
          Professores. A lupa troca a barra pelo campo de pesquisa; com a
          pesquisa a funcionar, o filtro deixa de mandar e mostram-se os
          resultados de tudo. «✕» limpa e volta às pastilhas. */}
      <StickyTop className="!mt-0">
        <FilterBar
          search={{ value: query, onChange: setQuery, placeholder: t('comunidade.search_placeholder_orgs') }}
          options={TABS.map((f) => ({ value: f.key, label: t(f.labelKey), dot: f.dot }))}
          value={tab}
          onChange={setTab}
          label={t('comunidade.title')}
        />
      </StickyTop>

      {busy ? (
        // A forma da página em vez da roda (esqueletos, 12 out).
        <SkeletonGate>
          <section>
            <SkLine size="label" w="40%" className="mb-2.5" />
            {tab === 'teachers'
              ? <div className="space-y-2.5"><SkRow /><SkRow /><SkRow /><SkRow /></div>
              : <div className="space-y-3"><OrgCardSkeleton /><OrgCardSkeleton /></div>}
          </section>
        </SkeletonGate>
      ) : showStart ? (
        renderStart()
      ) : nothing ? (
        tab === 'following' && !searching ? (
          <EmptyState title={t('comunidade.following_empty_title')} subtitle={t('comunidade.following_empty_text')} />
        ) : (
          <EmptyState
            // Em «Professores», vazio fala de professores (falha do QA, 26 set).
            title={!searching && tab === 'teachers' ? t('comunidade.no_teachers_title') : t('comunidade.nothing_found_title')}
            subtitle={searching ? t('comunidade.try_another_name') : tab === 'teachers' ? t('comunidade.no_teachers_subtitle') : t('comunidade.no_clubs_subtitle')}
          />
        )
      ) : (
        <>
          {showOrgs && sections.map((sec) => (
            <section key={sec.key}>
              <p className={monoHeading}>{sec.counted ? sec.title : `${sec.title} · ${sec.orgs.length}`}</p>
              <div className="space-y-3">{sec.orgs.map(renderOrgCard)}</div>
            </section>
          ))}

          {showTeachers && approvedTeachers.length > 0 && (
            <section>
              <p className={monoHeading}>{t('comunidade.tab_teachers')} · {approvedTeachers.length}</p>
              <div className="space-y-3">{approvedTeachers.map(renderTeacher)}</div>
            </section>
          )}
        </>
      )}

      {zoneOpen && (
        <ZoneSheet zone={myZone} onClose={() => setZoneOpen(false)}
          onPick={(d) => { writeZone(d); setZone(d); setZoneOpen(false) }} />
      )}

      <ConfirmSheet
        open={!!askUnfollow}
        danger
        title={askUnfollow ? t(askUnfollow.user?.gender === 'feminino' ? 'teacher.unfollow_title_f' : 'teacher.unfollow_title', { name: (askUnfollow.user?.name || '').split(' ')[0] }) : ''}
        message={t(askUnfollow?.user?.gender === 'feminino' ? 'teacher.unfollow_text_f' : 'teacher.unfollow_text')}
        cancelLabel={t('teacher.unfollow_keep')}
        confirmLabel={t('teacher.unfollow_confirm')}
        onConfirm={() => handleTeacherUnfollow(askUnfollow)}
        onClose={() => setAskUnfollow(null)}
      />
    </div>
  )
}
