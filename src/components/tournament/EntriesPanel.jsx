import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Check, X, UserPlus, Send, Copy } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { searchPlayers } from '../../lib/privateMatches'
import { useAuth } from '../../contexts/AuthContext'
import { Sheet } from '../agenda/AgendaControls'
import { Avatar, ConfirmSheet, PrimaryButton, EmptyState, Chips, NeedsYou } from '../ui'
import { partnerNameError, partnerEmailError } from '../../lib/partnerInvite'
import { listEntries, validateEntry, removeEntry, adminSignUp, adminSetPartner, tournamentInviteLink, inviteToken, inviteTokenPlayer1, whoIsAlreadyIn } from '../../lib/tournamentSignup'
import { whatsappShare } from '../../lib/partnerInvite'
import { signupErrorMessage, errorCode } from '../../lib/tournamentError'

/* Separador «Inscritos» (Trello #362).
   Desenho: print 08 (lista por categoria, Validar a um toque) e a regra
   dos nomes de 19 set — num torneio os nomes são visíveis a todos.

   Duas vistas no mesmo sítio: quem chega de fora vê a lista de duplas;
   o organizador vê também o estado de cada uma, valida o pagamento,
   remove, e inscreve à mão quem veio do formulário do clube. */

const STATE_TONE = {
  validada: 'bg-ok/10 text-ok-700',
  selecionada: 'bg-ok/10 text-ok-700',
  por_validar: 'bg-[#E0F2FE] text-[#075985]',
  convite: 'bg-ink-50 text-muted',
  sem_parceiro: 'bg-ink-50 text-muted',
  suplente: 'bg-amber-50 text-[#B86E00]',
}

const FILTERS = ['all', 'por_validar', 'sem_parceiro', 'suplente']

function pairName(e, t) {
  const second = e.player2_name || e.guest_name
  if (!second) return e.player1_name || '?'
  return `${e.player1_name} / ${second}`
}

/* Quem, na dupla, entrou só pelo nome (Trello #515: o jogador 1 também pode).
   Diz-se o nome — com um «sem conta» solto não se sabia de qual dos dois. */
function noAccountTag(e, t) {
  const p1 = !e.player1_id && !!e.player1_name
  const p2 = !!(e.player2_is_guest || (!e.player2_id && e.guest_name))
  if (p1 && p2) return t('tentries.no_account_both')
  if (p1) return t('tentries.no_account_named', { name: e.player1_name })
  if (p2) return t('tentries.no_account_named', { name: e.player2_name || e.guest_name })
  return null
}

/* O bloco «Não está na app?» — nome e email de quem entra sem conta. O mesmo
   para o jogador 1 e para o 2 (Trello #515). */
function NotInApp({ t, name, setName, email, setEmail }) {
  return (
    <div className="rounded-ctrl border-2 border-line p-3 space-y-2">
      <p className="text-sm font-extrabold text-ink-900">{t('partner.not_in_app_title')}</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('tentries.admin_name_placeholder')} className="input-field" />
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder={t('partner.email_placeholder')} className="input-field" />
      {/* Dizer a verdade a quem passa as inscricoes do formulario para a
          app: o email fica guardado mas NAO sai daqui nenhum email — o
          convite vai pelo link (Trello #479). */}
      <p className="text-xs text-muted">{t('partner.email_hint')}</p>
    </div>
  )
}

/* Inscrever à mão — o Smash Cup ainda recebe inscrições pelo formulário
   do clube, e alguém tem de as passar para cá (ATUALIZACOES-21-SET, 6). */
/* `mode`: 'new' é o «Inscrever à mão» inteiro; 'partner' é só o parceiro,
   para juntar a quem se inscreveu sozinho (Trello #515) — a mesma procura,
   o mesmo «Não está na app?» e o mesmo género, sem duplicar nada. */
function AdminEntrySheet({ organizationId, categories = [], categoryId: initialCategoryId, busy, error, onConfirm, onClose, mode = 'new', title, excludeId = null }) {
  const newEntry = mode === 'new'
  const { t } = useTranslation()
  // A categoria escolhe-se aqui, à vista — antes vinha calada do painel e
  // dava para inscrever alguém na categoria errada sem dar por isso (Trello #453).
  const [categoryId, setCategoryId] = useState(initialCategoryId)
  const [members, setMembers] = useState([])
  const [q1, setQ1] = useState('')
  const [q2, setQ2] = useState('')
  const [player1, setPlayer1] = useState(null)
  const [partner, setPartner] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  // Jogador 1 sem conta, pelo nome (Trello #515).
  const [name1, setName1] = useState('')
  const [email1, setEmail1] = useState('')
  // «Sozinho, à espera de parceiro» (Trello #515): fica sem_parceiro.
  const [solo, setSolo] = useState(false)
  // Desmarcado à partida (Trello #516): quem se esquecesse de o tirar
  // validava uma dupla que não pagou. Marca-se quando o pagamento foi feito.
  const [paid, setPaid] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('memberships')
      .select('user_id, profile:profiles(id, name, avatar_url)')
      .eq('organization_id', organizationId)
      .then(({ data, error: err }) => {
        if (cancelled || err) return
        setMembers((data || []).filter((m) => m.profile)
          .map((m) => ({ id: m.user_id, name: m.profile.name || '?', avatar_url: m.profile.avatar_url }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt')))
      })
    return () => { cancelled = true }
  }, [organizationId])

  // Além dos membros do clube, qualquer pessoa com conta (Trello #457): num
  // torneio aberto quem se inscreve quase nunca é membro do clube. O
  // servidor (tournament_admin_signup) nunca exigiu ser membro — só o ecrã.
  const [others, setOthers] = useState({ 1: [], 2: [] })
  useEffect(() => {
    const timers = [[1, q1], [2, q2]].map(([slot, q]) => setTimeout(() => {
      if (q.trim().length < 2) { setOthers((o) => ({ ...o, [slot]: [] })); return }
      searchPlayers(q.trim())
        .then((rows) => setOthers((o) => ({ ...o, [slot]: rows })))
        .catch((err) => console.error('Error searching players:', err))
    }, 250))
    return () => timers.forEach(clearTimeout)
  }, [q1, q2])

  const PAGE = 5
  const find = (q, exclude, slot) => {
    const needle = q.trim().toLowerCase()
    const mine = members.filter((m) => !needle || m.name.toLowerCase().includes(needle))
    const seen = new Set(mine.map((m) => m.id))
    const all = [...mine, ...(needle ? others[slot].filter((p) => !seen.has(p.id)) : [])]
      .filter((m) => m.id !== exclude)
    return { shown: all.slice(0, PAGE), more: all.length > PAGE }
  }

  // Género (#433): quem tem conta e ainda não o definiu não entra sem ele.
  // O admin está a inscrever outra pessoa, por isso escolhe-o aqui e fica
  // gravado no perfil dela (decisão do Renato, 23 set).
  const [genders, setGenders] = useState({}) // { [userId]: 'masculino'|'feminino'|null }
  const [chosenGender, setChosenGender] = useState({}) // { [userId]: escolha do admin }
  useEffect(() => {
    const ids = [player1?.id, partner?.id].filter((id) => id && !(id in genders))
    if (!ids.length) return
    supabase.from('profiles').select('id, gender').in('id', ids).then(({ data, error: err }) => {
      if (err) { console.error('Error loading gender:', err); return }
      setGenders((g) => ({ ...g, ...Object.fromEntries(ids.map((id) => [id, (data || []).find((r) => r.id === id)?.gender || null])) }))
    })
  }, [player1?.id, partner?.id, genders])
  const needsGender = (p) => !!p && p.id in genders && !genders[p.id]
  const genderOk = (p) => !needsGender(p) || !!chosenGender[p.id]

  const nameError = name ? partnerNameError(name) : null
  const guestOk = (n, e) => !!n.trim() && !partnerNameError(n) && !partnerEmailError(e)
  const player1Ok = player1 ? genderOk(player1) : guestOk(name1, email1)
  const partnerOk = solo || (partner ? genderOk(partner) : (!!name && !nameError && !partnerEmailError(email)))
  const ready = newEntry ? player1Ok && partnerOk : partnerOk

  // Chamado como função, não como <Picker/>: um componente definido aqui
  // dentro era recriado a cada letra e a caixa perdia o foco.
  const picker = ({ label, q, setQ, picked, setPicked, exclude, slot }) => {
    const { shown, more } = find(q, exclude, slot)
    return (

    <div className="space-y-1.5">
      {/* Rótulos de campo como no Criar mix (revisão «mesma app», 26 set). */}
      <p className="block text-sm font-medium text-gray-700 mb-2">{label}</p>
      {picked ? (
        <>
        <button onClick={() => setPicked(null)} className="press flex w-full items-center gap-2.5 rounded-ctrl border-2 border-ok bg-ok/5 px-3 py-2">
          <Avatar name={picked.name} url={picked.avatar_url} size="w-8 h-8 text-[11px]" />
          <span className="text-sm font-semibold text-ink-900">{picked.name}</span>
        </button>
        {needsGender(picked) && (
          <div className="rounded-ctrl border border-line p-2.5 space-y-1.5">
            <p className="text-xs text-ink-700">{t('tentries.admin_gender_missing', { name: picked.name })}</p>
            <div className="flex gap-1.5">
              {[['masculino', t('login.gender_male')], ['feminino', t('login.gender_female')]].map(([g, label]) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setChosenGender((c) => ({ ...c, [picked.id]: g }))}
                  aria-pressed={chosenGender[picked.id] === g}
                  className={`press flex-1 rounded-full border px-3 py-1.5 text-sm font-extrabold ${
                    chosenGender[picked.id] === g ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        </>
      ) : (
        <>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('partner.search_placeholder')} className="input-field pl-9" />
          </div>
          <div className="space-y-1">
            {shown.map((m) => (
              <button key={m.id} onClick={() => setPicked(m)} className="press flex w-full items-center gap-2.5 rounded-ctrl bg-ink-50 px-3 py-2 text-left">
                <Avatar name={m.name} url={m.avatar_url} size="w-8 h-8 text-[11px]" />
                <span className="text-sm font-semibold text-ink-900 truncate">{m.name}</span>
              </button>
            ))}
            {q.trim() && shown.length === 0 && (
              <p className="px-1 text-xs text-muted">{t('tentries.admin_search_empty')}</p>
            )}
            {more && <p className="px-1 text-xs text-muted">{t('tentries.admin_search_more')}</p>}
          </div>
        </>
      )}
    </div>
    )
  }

  return (
    <Sheet onClose={onClose} title={title || t('tentries.admin_add_title')}>
      <div className="space-y-4">
        {newEntry && categories.length > 1 && (
          <div>
            <p className="block text-sm font-medium text-gray-700 mb-2">{t('tentries.admin_category')}</p>
            <Chips
              label={t('tentries.admin_category')}
              value={categoryId}
              onChange={setCategoryId}
              options={categories.map((c) => ({ value: c.id, label: c.code || c.name }))}
            />
          </div>
        )}
        {newEntry && (
          <>
            {picker({ label: t('tentries.admin_player1'), q: q1, setQ: setQ1, picked: player1, setPicked: setPlayer1, exclude: partner?.id, slot: 1 })}
            {!player1 && NotInApp({ t, name: name1, setName: setName1, email: email1, setEmail: setEmail1 })}

            {/* Com parceiro, ou sozinho à espera de um (Trello #515). É uma
                escolha num formulário: pastilhas, não separador (#528). */}
            <Chips
              value={solo}
              onChange={setSolo}
              options={[
                { value: false, label: t('tentries.admin_with_partner') },
                { value: true, label: t('tentries.admin_alone') },
              ]}
            />
          </>
        )}

        {(!newEntry || !solo) && (
          <>
            {picker({ label: t('tentries.admin_player2'), q: q2, setQ: setQ2, picked: partner, setPicked: setPartner, exclude: player1?.id || excludeId, slot: 2 })}
            {!partner && NotInApp({ t, name, setName, email, setEmail })}
          </>
        )}

        {newEntry && solo && <p className="text-xs text-muted">{t('tentries.admin_alone_hint')}</p>}

        {newEntry && (
          <label className="flex items-center gap-2.5 text-sm font-semibold text-ink-900">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-5 w-5 rounded" />
            {t('tentries.admin_paid')}
          </label>
        )}

        {error && <p className="text-sm text-red-600 font-extrabold">{error}</p>}

        <PrimaryButton
          onClick={() => {
            if (!ready) return
            const second = {
              partnerId: partner?.id || null,
              partnerGender: needsGender(partner) ? chosenGender[partner.id] : null,
              guestName: partner ? null : name.trim() || null,
              guestEmail: partner ? null : email.trim() || null,
            }
            if (!newEntry) { onConfirm(second); return }
            onConfirm({
              categoryId,
              player1Id: player1?.id || null,
              player1GuestName: player1 ? null : name1.trim(),
              player1GuestEmail: player1 ? null : email1.trim() || null,
              player1Gender: needsGender(player1) ? chosenGender[player1.id] : null,
              ...(solo ? { partnerId: null, partnerGender: null, guestName: null, guestEmail: null } : second),
              paid,
            })
          }}
          disabled={!ready || busy}
          className="w-full"
        >
          {t(newEntry ? 'tentries.admin_add_confirm' : 'tentries.join_partner')}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}

export default function EntriesPanel({ tournament, categories = [], category }) {
  const { t } = useTranslation()
  const { adminOrganizations } = useAuth()
  const isAdmin = (adminOrganizations || []).some?.((o) => (o.id || o) === tournament.organization_id)
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [askRemove, setAskRemove] = useState(null) // a inscrição a tirar
  const [addOpen, setAddOpen] = useState(false)
  // Juntar parceiro a quem está sozinho (Trello #515).
  const [joinFor, setJoinFor] = useState(null)

  const load = () => {
    if (!category?.id) return
    if (isAdmin) {
      listEntries(category.id)
        .then((data) => setRows(data.map((r) => ({ ...r, id: r.entry_id }))))
        .catch((err) => console.error('Error loading tournament entries:', err))
      return
    }
    supabase
      .from('tournament_public_entries')
      .select('*')
      .eq('category_id', category.id)
      .then(({ data, error: err }) => {
        if (err) { console.error('Error loading tournament entries:', err); return }
        setRows(data || [])
      })
  }
  useEffect(load, [category?.id, isAdmin])

  // Quem desistiu fica na lista, marcado — desaparecer a meio do torneio
  // deixava o adversário em branco no quadro (vista do Dev 3, 22 set).
  const shown = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  )

  // Dois números que se liam mal juntos: o de cima contava as confirmadas e
  // a lista mostrava tudo. Agora diz-se o que cada um é.
  const confirmed = rows.filter((r) => ['validada', 'selecionada'].includes(r.status)).length

  // "20 set" — curto, que a linha é estreita.
  const signedUpOn = (iso) => new Date(iso).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })

  // Reenviar o link de quem entrou pelo nome, para colar no WhatsApp. O
  // código vai-se buscar agora, não vem na lista (revisão do Dev 3).
  /* Traduz o erro quando há tradução, e cai no genérico quando não há.
     Até aqui o organizador lia «Não foi possível. Tenta outra vez.»
     acontecesse o que acontecesse — validar uma dupla incompleta, um
     suplente, ou fora de prazo davam todos a mesma frase. E é ele que está
     no pavilhão no dia do torneio, com gente à frente (Trello #476).

     A conta vive em lib/tournamentError.js: o padrão que andava copiado à
     mão perdia o algarismo de «player1_gender_required». */
  const say = (err) => setError(signupErrorMessage(t, err))

  // «Inscrever à mão» recusado porque um dos dois já está nesta categoria
  // (Trello #480). O servidor manda o mesmo código seja qual for dos dois,
  // e a frase de sempre — «Essa dupla já está inscrita» — estava errada:
  // a dupla nova não existe, é UM deles que já lá está, com outra pessoa.
  // Vai-se ver à lista da categoria ESCOLHIDA (pode não ser a do painel),
  // e diz-se o nome. Só neste caminho de erro, por isso não custa nada.
  const adminSignupError = async (err, choice) => {
    if (errorCode(err) !== 'already_in_category') return signupErrorMessage(t, err)
    try {
      const name = whoIsAlreadyIn(await listEntries(choice.categoryId), [choice.player1Id, choice.partnerId])
      return name ? t('tentries.error_already_in_category_named', { name }) : t('tentries.error_already_in_category')
    } catch {
      return t('tentries.error_already_in_category')
    }
  }

  // Reenviar: abre a folha dos links com o de cada pessoa sem conta da
  // dupla — o jogador 1, o 2, ou os dois (Trello #515).
  const share = async (e) => {
    try {
      const links = []
      if (!e.player1_id) {
        const token = await inviteTokenPlayer1(e.entry_id)
        if (token) links.push({ token, name: e.player1_name || '', email: null })
      }
      if (!e.player2_id && e.guest_name) {
        const token = await inviteToken(e.entry_id)
        if (token) links.push({ token, name: e.guest_name, email: null })
      }
      if (links.length) setFresh(links)
    } catch (err) {
      console.error('Error getting the invite token:', err)
      say(err)
    }
  }

  // O convite acabado de criar, para o mostrar em vez de fechar a folha em
  // silêncio (Trello #479, ponto 2). Quem passa as inscrições do formulário
  // para a app fechava a folha a pensar que a pessoa tinha sido avisada —
  // e o link, que é a única forma de ela ficar com o lugar, estava escondido
  // atrás do avião de papel na lista. A `tournament_admin_signup` já devolve
  // o `invite_token`, por isso não é preciso ir buscá-lo outra vez.
  // Uma pessoa por link: desde o #515 podem ser duas (nenhuma com conta).
  const [fresh, setFresh] = useState(null) // [{ token, name, email }]
  const linkOf = (token) => tournamentInviteLink(token, window.location.origin)

  const act = async (fn) => {
    setBusy(true); setError('')
    try { await fn(); load() }
    catch (err) { console.error('Error acting on a tournament entry:', err); say(err) }
    finally { setBusy(false) }
  }

  if (!category) return null

  return (
    <div className="space-y-3">
      {isAdmin && (
        <>
          {/* Filtros: as pastilhas da app, numa só linha (revisão «mesma app»). */}
          <Chips
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({
              value: f,
              label: `${t(`tentries.filter_${f}`)} ${f === 'all' ? rows.length : rows.filter((r) => r.status === f).length}`,
            }))}
          />
          <button type="button" onClick={() => { setError(''); setAddOpen(true) }} className="btn-secondary w-full inline-flex items-center justify-center gap-2">
            <UserPlus size={18} /> {t('tentries.admin_add_title')}
          </button>
        </>
      )}

      {error && <p className="text-sm text-red-600 font-extrabold">{error}</p>}

      <p className="text-xs text-muted">
        {t('tentries.count_line', {
          confirmed: t('tournament.n.confirmed', { count: confirmed }),
          total: t('tournament.n.entries', { count: rows.length }),
        })}
        {category.slots ? ` · ${t('tentries.count_slots', { count: category.slots })}` : ''}
      </p>

      {shown.length === 0 ? (
        <EmptyState icon={UserPlus} title={t('tentries.empty_title')} subtitle={t('tentries.empty_subtitle')} />
      ) : (
        <div className="space-y-1.5">
          {shown.map((e) => (
            <div key={e.id || e.entry_id} className="space-y-1.5">
            <div className={`card flex items-center gap-3 py-3 ${
              (e.withdrawn || e.status === 'desistiu') ? 'opacity-60' : ''}`}>
              <div className="min-w-0 flex-1">
                {/* Até duas linhas: com os botões ao lado, «Carla N…» não
                    dizia quem era (Trello #515). */}
                <p className="font-extrabold text-ink-900 line-clamp-2 break-words">
                  {e.team_name || pairName(e, t)}
                </p>
                <p className="text-xs text-muted line-clamp-2">
                  {[
                    e.team_name ? pairName(e, t) : null,
                    e.status === 'suplente' && e.waitlist_order ? t('tentries.waitlist_n', { n: e.waitlist_order }) : null,
                    noAccountTag(e, t),
                    (e.withdrawn || e.status === 'desistiu') ? t('tentries.state_desistiu') : null,
                    // Quando se inscreveu — é por aqui que o organizador
                    // percebe a ordem de chegada (print 08).
                    e.created_at ? t('tentries.signed_up_on', { date: signedUpOn(e.created_at) }) : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>

              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${STATE_TONE[e.status] || 'bg-ink-50 text-muted'}`}>
                {t(`tentries.state_${e.status}`)}
              </span>

              {isAdmin && e.status !== 'desistiu' && (
                <div className="flex shrink-0 gap-1">
                  {/* Reenviar o convite de quem ainda não tem conta: o link
                      é a única forma de ele ficar com o lugar. */}
                  {e.has_invite && (!e.player1_id || (!e.player2_id && e.guest_name)) && (
                    <button
                      onClick={() => share(e)}
                      disabled={busy}
                      aria-label={t('tentries.invite_again')}
                      className="press flex h-11 w-11 items-center justify-center rounded-full bg-ink-50 text-ink-900"
                    >
                      <Send size={16} />
                    </button>
                  )}
                  {e.status === 'por_validar' && (
                    <button
                      onClick={() => act(() => validateEntry(e.entry_id, true))}
                      disabled={busy}
                      aria-label={t('tentries.validate')}
                      className="press flex h-11 w-11 items-center justify-center rounded-full bg-lime-400 text-ink-900"
                    >
                      <Check size={18} />
                    </button>
                  )}
                  <button
                    onClick={() => { setError(''); setAskRemove(e) }}
                    disabled={busy}
                    aria-label={t('tentries.remove')}
                    className="press flex h-11 w-11 items-center justify-center rounded-full bg-ink-50 text-muted"
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
            </div>
            {/* Sozinho à espera de parceiro: «Precisa de ti», com a ação
                que resolve (regra de 25 set; Trello #515). */}
            {isAdmin && e.status === 'sem_parceiro' && (
              <NeedsYou action={{ label: t('tentries.join_partner'), onClick: () => { setError(''); setJoinFor(e) }, disabled: busy }}>
                {t('tentries.needs_partner', { name: e.player1_name || '?' })}
              </NeedsYou>
            )}
            </div>
          ))}
        </div>
      )}

      {/* Tirar uma dupla pergunta na folha da app (#435). */}
      <ConfirmSheet
        open={!!askRemove}
        danger
        title={t('tentries.remove_title', { name: askRemove ? (askRemove.team_name || pairName(askRemove, t)) : '', category: category.name })}
        message={t('tentries.remove_consequence')}
        cancelLabel={t('tentries.remove_keep')}
        confirmLabel={t('tentries.remove_yes')}
        onConfirm={async () => { await removeEntry(askRemove.entry_id); load() }}
        onClose={() => setAskRemove(null)}
        errorOf={(err) => signupErrorMessage(t, err)}
      />

      {addOpen && (
        <AdminEntrySheet
          organizationId={tournament.organization_id}
          categories={categories}
          categoryId={category.id}
          busy={busy}
          error={error}
          onConfirm={async (choice) => {
            // A folha só fecha quando a inscrição ficou feita (Trello #480).
            // Antes fechava sempre — o `act` apanha o erro e resolve na mesma
            // — e o organizador perdia a categoria, os dois jogadores, o
            // nome, o email e o «já pagou». No dia do Smash Cup, a passar
            // dezenas de duplas, era voltar ao princípio a cada engano. Agora
            // o erro aparece dentro da folha, ao lado do que escreveu.
            setBusy(true); setError('')
            try {
              const res = await adminSignUp(choice)
              // Só há link para quem entrou sem conta — o jogador 1, o 2,
              // ou os dois (Trello #515).
              const links = []
              if (res?.invite_token_player1 && choice.player1GuestName) {
                links.push({ token: res.invite_token_player1, name: choice.player1GuestName, email: choice.player1GuestEmail || null })
              }
              if (res?.invite_token && choice.guestName) {
                links.push({ token: res.invite_token, name: choice.guestName, email: choice.guestEmail || null })
              }
              if (links.length) setFresh(links)
              load()
              setAddOpen(false)
            } catch (err) {
              console.error('Error signing up by hand:', err)
              setError(await adminSignupError(err, choice))
            } finally {
              setBusy(false)
            }
          }}
          onClose={() => { setAddOpen(false); setError('') }}
        />
      )}

      {joinFor && (
        <AdminEntrySheet
          mode="partner"
          excludeId={joinFor.player1_id}
          title={t('tentries.join_partner_title', { name: joinFor.player1_name || '?' })}
          organizationId={tournament.organization_id}
          busy={busy}
          error={error}
          onConfirm={async (choice) => {
            setBusy(true); setError('')
            try {
              const res = await adminSetPartner(joinFor.entry_id, choice)
              if (res?.invite_token && choice.guestName) {
                setFresh([{ token: res.invite_token, name: choice.guestName, email: choice.guestEmail || null }])
              }
              load()
              setJoinFor(null)
            } catch (err) {
              console.error('Error joining a partner:', err)
              setError(signupErrorMessage(t, err))
            } finally {
              setBusy(false)
            }
          }}
          onClose={() => { setJoinFor(null); setError('') }}
        />
      )}

      {/* Inscreveu alguém sem conta: o link é como ele fica a saber. Mesma
          folha que o jogador vê ao inscrever a dupla dele (SignupSlot); com
          uma dupla sem contas, um link por pessoa (Trello #515). */}
      {fresh && (
        <Sheet title={t('tsignup.invite_ready_title')} onClose={() => setFresh(null)}>
          <div className="space-y-5">
            {fresh.map((f, i) => (
              <div key={f.token} className="space-y-3">
                {fresh.length > 1 && <p className="text-sm font-extrabold text-ink-900">{f.name}</p>}
                {/* Sem o «Tu e o {nome} ficam dupla» que o jogador vê: aqui
                    quem inscreve não faz parte da dupla. */}
                <p className="text-sm text-ink-900">
                  {/* Com o nome e sem «ele»: podem ser duas pessoas, e de
                      qualquer género (Trello #515). */}
                  {f.email ? t('partner.invite_ready_email', { email: f.email }) : t('tentries.invite_ready_named', { name: f.name })}
                </p>
                <div className="rounded-ctrl bg-ink-50 px-3 py-2 text-xs text-ink-900 break-all">{linkOf(f.token)}</div>
                {/* Um só botão lima na folha (vigia da designer, 25 set): com
                    duas pessoas sem conta, o WhatsApp da segunda é contorno. */}
                {i === 0 ? (
                  <PrimaryButton
                    onClick={() => window.open(whatsappShare(t('tsignup.invite_whatsapp_text', { name: f.name, title: tournament.name, link: linkOf(f.token) })), '_blank')}
                    className="w-full"
                  >
                    {t('partner.invite_send_whatsapp')}
                  </PrimaryButton>
                ) : (
                  <button type="button"
                    onClick={() => window.open(whatsappShare(t('tsignup.invite_whatsapp_text', { name: f.name, title: tournament.name, link: linkOf(f.token) })), '_blank')}
                    className="btn-secondary w-full inline-flex items-center justify-center gap-2">
                    {t('partner.invite_send_whatsapp')}
                  </button>
                )}
                <button type="button" onClick={() => navigator.clipboard?.writeText(linkOf(f.token))}
                  className="btn-secondary w-full inline-flex items-center justify-center gap-2">
                  <Copy size={18} /> {t('partner.invite_copy_link')}
                </button>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  )
}
