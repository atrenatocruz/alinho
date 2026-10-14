import { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Users, Clock, GraduationCap, Lock, Check, Plus, ChevronRight } from 'lucide-react'
import { searchOrganizations, listGlobalOrganizations } from '../lib/organizations'
import { DAYS, listTeachersPublic, teacherClubName } from '../lib/teachers'
import { scheduleFromRows, shortRange } from '../lib/teacherSchedule'
import { teacherContact } from '../lib/teacherContact'
import { LevelPill, bandLabel } from '../components/lessons/LessonBits'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { followPlayer, removeFollow } from '../lib/follows'
import { Avatar, ConfirmSheet, EmptyState, GroupLevelBadge, PageHeader, StickyTop, FilterBar } from '../components/ui'
import { describeError } from '../lib/errors'
import { useHeaderActions } from '../contexts/HeaderActionsContext'
import { semAcentos } from '../lib/semAcentos'
import KindHero from '../components/KindHero'
import { CLUB_HERO, GROUP_HERO, KIND_COLORS } from '../lib/kindColors'
import { Realce } from '../components/SearchField'

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
// A letra do nível médio (level_letter) → os géneros que o peopleRatingBand espera.
const LETTER_GENDERS = { M: ['masculino'], F: ['feminino'], MX: ['masculino', 'feminino'] }

const TABS = [
  { key: 'all', labelKey: 'comunidade.filter_all' },
  { key: 'clubs', labelKey: 'comunidade.filter_clubs', dot: '#040404' },
  { key: 'groups', labelKey: 'comunidade.filter_groups', dot: KIND_COLORS.friends.strong },
  { key: 'teachers', labelKey: 'comunidade.tab_teachers', dot: KIND_COLORS.lesson.strong },
]

// A mesma regra de todas as pesquisas de nomes (src/lib/semAcentos.js).
const norm = semAcentos
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'pt')

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

  const [teachers, setTeachers] = useState([])
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

  // ── Clubes e grupos ────────────────────────────────────────────────────
  // Os meus vêm das memberships (incluem os que não aparecem na pesquisa);
  // quando o diretório os traz, usa-se essa linha, que tem nº de membros e
  // nível médio.
  const directoryById = useMemo(() => new Map(organizations.map((o) => [o.id, o])), [organizations])
  const myOrgs = useMemo(() => memberships
    .map((m) => m.organization)
    .filter(Boolean)
    .map((o) => directoryById.get(o.id) || { ...o, my_status: 'member' })
    .sort(byName), [memberships, directoryById])
  const myOrgIds = new Set(myOrgs.map((o) => o.id))
  const pendingOrgs = organizations.filter((o) => o.my_status === 'pending')

  const matchesQuery = (o) => trimmed.length < 2 || norm(o.name).includes(norm(trimmed))

  // Clubes e grupos numa lista só: com seis linhas, separar por tipo não
  // ajuda ninguém a encontrar nada. Onde já estás vem primeiro.
  const listedOrgs = (() => {
    const mine = [...myOrgs, ...pendingOrgs.filter((o) => !myOrgIds.has(o.id))].filter(matchesQuery)
    const others = organizations.filter((o) => !myOrgIds.has(o.id) && !pendingOrgs.includes(o)).filter(matchesQuery)
    return [...mine, ...others]
  })()
  // «Os teus» (R8, 13 out): uma fila das fotos onde és membro, só em
  // «Todos» e sem pesquisa.
  const showMineRow = tab === 'all' && trimmed.length < 2 && myOrgs.length > 0

  // ── Professores ────────────────────────────────────────────────────────
  const approvedTeachers = teachers
    .filter((teacher) => teacher.user_id !== user.id && teacher.status === 'approved')
    .filter((teacher) => trimmed.length < 2
      || norm(teacher.user?.name).includes(norm(trimmed))
      || norm(teacherClubName(teacher)).includes(norm(trimmed))
      || norm(teacher.zone).includes(norm(trimmed)))
  // A pesquisa procura nos três ao mesmo tempo: é ela que faz o trabalho
  // que as cinco pastilhas estavam a tentar fazer.
  const searching = trimmed.length > 1
  const verTudo = tab === 'all' || searching
  const showTeachers = tab === 'teachers' || verTudo
  const showOrgs = tab === 'clubs' || tab === 'groups' || verTudo
  // «Todos» e a pesquisa mostram os dois tipos; senão, só o do filtro.
  const shownOrgs = verTudo ? listedOrgs : listedOrgs.filter((o) => (o.kind === 'group') === (tab === 'groups'))
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

  // ── Cartão de clube/grupo (R8 do redesign, 13 out) ───────────────────
  // A toda a largura: em cima, o Alino do clube ou do grupo (R0; a foto do
  // clube entra quando houver onde a guardar — dados novos, para 23), e
  // «Por pedido» no canto quando a entrada não é livre; o logótipo a passar
  // por cima, o nome em grande e «Clube · Lisboa · 48 membros · nível médio
  // M4» (no grupo, «Grupo do <clube>»); em baixo, um botão a toda a largura.
  const renderOrgCard = (org) => {
    const status = myOrgIds.has(org.id) ? 'member' : org.my_status
    // Grupo dentro de um clube: entra-se sempre por pedido (follow_organization).
    const joinsDirectly = org.open_join && !org.parent_organization_id
    const group = org.kind === 'group'
    const sub = [
      group && org.parent_name ? t('comunidade.group_of', { club: org.parent_name }) : t(group ? 'clubprofile.kind_group' : 'clubprofile.kind_club'),
      group && org.parent_name ? null : org.city,
      org.member_count != null ? t('comunidade.member_count', { count: org.member_count }) : null,
    ].filter(Boolean).join(' · ')
    return (
      <Link key={org.id} to={`/clube/${org.slug}`} className="block overflow-hidden rounded-[22px] bg-white shadow-card press">
        <KindHero kind="club" src={group ? GROUP_HERO : CLUB_HERO} className="relative h-[104px]">
          {org.open_join === false && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-extrabold text-white backdrop-blur-sm" title={t('comunidade.closed_aria')}>
              <Lock size={12} /> {t('comunidade.by_request')}
            </span>
          )}
        </KindHero>
        <div className="px-4 pb-4">
          <span className={`relative -mt-9 inline-block bg-white p-[3px] ${group ? 'rounded-full' : 'rounded-[28%]'}`}>
            <Avatar name={org.name} url={org.group_logo_url} size="w-14 h-14 text-lg" shape={group ? 'round' : 'square'} colorClass="bg-ink-900 text-lime-400" />
          </span>
          {/* A parte encontrada a lima-claro (pesquisa, 14 out). */}
          <h3 className="mt-1 font-display text-xl font-extrabold leading-tight text-ink-900 break-words"><Realce text={org.name || ''} query={trimmed} /></h3>
          <p className="mt-0.5 text-sm text-muted">
            {sub}
            {/* A letra (M, F ou MX) vem já feita da base (level_letter, Dev 3,
                para 23): mandar os géneros dos membros dizia o de cada pessoa
                num grupo pequeno. Sem letra, o nível não aparece. */}
            {org.avg_rating != null && LETTER_GENDERS[org.level_letter] && (
              <span className="whitespace-nowrap"> · {t('comunidade.avg_level_inline')} <GroupLevelBadge rating={org.avg_rating} genders={LETTER_GENDERS[org.level_letter]} /></span>
            )}
          </p>
          <div className="mt-3.5">
            {status === 'member' ? (
              <span className="flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-[14px] bg-[#F4F8DC] py-3 font-display text-[14px] font-extrabold leading-none text-[#3F6212]">
                <Check size={15} /> {t('clubprofile.is_member')}
              </span>
            ) : status === 'pending' ? (
              <span className="flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-[14px] bg-[#F4F5F1] py-3 font-display text-[14px] font-extrabold leading-none text-ink-500">
                <Clock size={15} /> {t('comunidade.request_sent')}
              </span>
            ) : (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); handleFollow(org) }}
                disabled={actingOn === org.id}
                className={`flex min-h-[48px] w-full items-center justify-center rounded-ctrl text-base font-extrabold transition-colors duration-fast disabled:opacity-40 ${
                  joinsDirectly ? 'bg-lime-400 text-ink-900 hover:bg-lime-600' : 'border-[1.5px] border-ink-900 bg-white text-ink-900 hover:bg-ink-50'
                }`}
              >
                {joinsDirectly ? t('comunidade.join_action') : t('comunidade.request_entry_action')}
              </button>
            )}
            {cardError[org.id] && <p role="alert" className="mt-2 rounded-ctrl border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs font-bold text-danger">{cardError[org.id]}</p>}
          </div>
        </div>
      </Link>
    )
  }

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
  const nothing = !busy
    && (!showOrgs || shownOrgs.length === 0)
    && (!showTeachers || approvedTeachers.length === 0)

  return (
    <div className="space-y-4">
      {/* O título sobe e sai; a barra fica presa em cima (R4, 13 out). */}
      <PageHeader sticky={false} title={t('comunidade.title')}>{headerActions}</PageHeader>

      {/* A barra da Home: 🔍 | Todos · Clubes · Grupos · Professores. A lupa
          troca a barra pelo campo de pesquisa; com a pesquisa a funcionar, o
          filtro deixa de mandar e mostram-se os resultados de tudo. «✕»
          limpa e volta às pastilhas. */}
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
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
        </div>
      ) : nothing ? (
        <EmptyState
          icon={tab === 'teachers' ? GraduationCap : Users}
          // Em «Professores», vazio fala de professores (falha do QA, 26 set).
          title={!searching && tab === 'teachers' ? t('comunidade.no_teachers_title') : t('comunidade.nothing_found_title')}
          subtitle={searching ? t('comunidade.try_another_name') : tab === 'teachers' ? t('comunidade.no_teachers_subtitle') : t('comunidade.no_clubs_subtitle')}
        />
      ) : (
        <>
          {showMineRow && (
            <section>
              <p className="mb-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[.1em] text-[#4F535A]">{t('comunidade.mine_heading')} · {myOrgs.length}</p>
              {/* 6 px em cima e 4 px em baixo: o anel lima está por fora do
                  círculo e a fila que desliza cortava-o (Francisco, 13 out). */}
              <div className="no-scrollbar -mx-4 flex gap-3.5 overflow-x-auto px-4 pb-1 pt-1.5">
                {myOrgs.map((org) => (
                  <Link key={org.id} to={`/clube/${org.slug}`} className="w-[84px] shrink-0 flex flex-col items-center gap-1.5 text-center">
                    {/* A mesma imagem do cartão, com o anel lima (protótipo, UX 13 out). */}
                    <img src={org.group_logo_url || (org.kind === 'group' ? GROUP_HERO : CLUB_HERO)} alt="" loading="lazy"
                      className="h-[62px] w-[62px] rounded-full object-cover shadow-[0_0_0_2px_#fff,0_0_0_4px_#C8DC00]" />
                    <span className="text-[13px] font-extrabold text-ink-900 leading-tight line-clamp-2 break-words">{org.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {showOrgs && shownOrgs.length > 0 && (
            <section>
              <p className="mb-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[.1em] text-[#4F535A]">
                {searching
                  ? t('comunidade.results_count', { count: shownOrgs.length + (showTeachers ? approvedTeachers.length : 0) })
                  : t({ clubs: 'comunidade.filter_clubs', groups: 'comunidade.filter_groups' }[tab] || 'comunidade.tab_orgs')}
              </p>
              <div className="space-y-3">{shownOrgs.map(renderOrgCard)}</div>
            </section>
          )}

          {showTeachers && approvedTeachers.length > 0 && (
            <section>
              <p className="mb-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[.1em] text-[#4F535A]">{t('comunidade.tab_teachers')} · {approvedTeachers.length}</p>
              <div className="space-y-3">{approvedTeachers.map(renderTeacher)}</div>
            </section>
          )}
        </>
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
