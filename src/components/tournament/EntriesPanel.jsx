import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Check, X, UserPlus, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Sheet } from '../agenda/AgendaControls'
import { Avatar, PrimaryButton, EmptyState } from '../ui'
import { partnerNameError, partnerEmailError } from '../../lib/partnerInvite'
import { listEntries, validateEntry, removeEntry, adminSignUp, tournamentInviteLink, inviteToken } from '../../lib/tournamentSignup'
import { whatsappShare } from '../../lib/partnerInvite'

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

/* Inscrever à mão — o Smash Cup ainda recebe inscrições pelo formulário
   do clube, e alguém tem de as passar para cá (ATUALIZACOES-21-SET, 6). */
function AdminEntrySheet({ organizationId, categoryId, busy, error, onConfirm, onClose }) {
  const { t } = useTranslation()
  const [members, setMembers] = useState([])
  const [q1, setQ1] = useState('')
  const [q2, setQ2] = useState('')
  const [player1, setPlayer1] = useState(null)
  const [partner, setPartner] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [paid, setPaid] = useState(true)

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

  const find = (q, exclude) => {
    const needle = q.trim().toLowerCase()
    return members.filter((m) => m.id !== exclude && (!needle || m.name.toLowerCase().includes(needle))).slice(0, 5)
  }

  const nameError = name ? partnerNameError(name) : null
  const ready = player1 && (partner || (name && !nameError && !partnerEmailError(email)))

  const Picker = ({ label, q, setQ, picked, setPicked, exclude }) => (
    <div className="space-y-1.5">
      <p className="font-mono text-[11px] uppercase tracking-widest text-ink-500">{label}</p>
      {picked ? (
        <button onClick={() => setPicked(null)} className="press flex w-full items-center gap-2.5 rounded-ctrl border-2 border-ok bg-ok/5 px-3 py-2">
          <Avatar name={picked.name} url={picked.avatar_url} size="w-8 h-8 text-[11px]" />
          <span className="text-sm font-semibold text-ink-900">{picked.name}</span>
        </button>
      ) : (
        <>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('partner.search_placeholder')} className="input-field pl-9" />
          </div>
          <div className="space-y-1">
            {find(q, exclude).map((m) => (
              <button key={m.id} onClick={() => setPicked(m)} className="press flex w-full items-center gap-2.5 rounded-ctrl bg-ink-50 px-3 py-2 text-left">
                <Avatar name={m.name} url={m.avatar_url} size="w-8 h-8 text-[11px]" />
                <span className="text-sm font-semibold text-ink-900 truncate">{m.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )

  return (
    <Sheet onClose={onClose} title={t('tentries.admin_add_title')}>
      <div className="space-y-4">
        <Picker label={t('tentries.admin_player1')} q={q1} setQ={setQ1} picked={player1} setPicked={setPlayer1} exclude={partner?.id} />
        <Picker label={t('tentries.admin_player2')} q={q2} setQ={setQ2} picked={partner} setPicked={setPartner} exclude={player1?.id} />

        {!partner && (
          <div className="rounded-ctrl border-2 border-line p-3 space-y-2">
            <p className="text-sm font-extrabold text-ink-900">{t('partner.not_in_app_title')}</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('partner.name_placeholder')} className="input-field" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder={t('partner.email_placeholder')} className="input-field" />
          </div>
        )}

        <label className="flex items-center gap-2.5 text-sm font-semibold text-ink-900">
          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-5 w-5 rounded" />
          {t('tentries.admin_paid')}
        </label>

        {error && <p className="text-sm text-red-600 font-extrabold">{error}</p>}

        <PrimaryButton
          onClick={() => ready && onConfirm({
            categoryId, player1Id: player1.id, partnerId: partner?.id || null,
            guestName: partner ? null : name.trim() || null,
            guestEmail: partner ? null : email.trim() || null,
            paid,
          })}
          disabled={!ready || busy}
          className="w-full"
        >
          {t('tentries.admin_add_confirm')}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}

export default function EntriesPanel({ tournament, category }) {
  const { t } = useTranslation()
  const { adminOrganizations } = useAuth()
  const isAdmin = (adminOrganizations || []).some?.((o) => (o.id || o) === tournament.organization_id)
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [addOpen, setAddOpen] = useState(false)

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
  const share = async (e) => {
    try {
      const token = await inviteToken(e.entry_id)
      if (!token) return
      const link = tournamentInviteLink(token, window.location.origin)
      window.open(whatsappShare(t('tsignup.invite_whatsapp_text', {
        name: e.guest_name || '', title: tournament.name, link,
      })), '_blank')
    } catch (err) {
      console.error('Error getting the invite token:', err)
      setError(t('tsignup.error_generic'))
    }
  }

  const act = async (fn) => {
    setBusy(true); setError('')
    try { await fn(); load() }
    catch (err) { console.error('Error acting on a tournament entry:', err); setError(t('tsignup.error_generic')) }
    finally { setBusy(false) }
  }

  if (!category) return null

  return (
    <div className="space-y-3">
      {isAdmin && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`press rounded-full px-3 py-1.5 text-sm font-semibold border-2 ${
                  filter === f ? 'border-ink-900 bg-ink-900 text-white' : 'border-line text-ink-900'
                }`}
              >
                {t(`tentries.filter_${f}`)} {f === 'all' ? rows.length : rows.filter((r) => r.status === f).length}
              </button>
            ))}
          </div>
          <PrimaryButton variant="ghost" onClick={() => setAddOpen(true)} className="w-full !bg-white !border-ink-900">
            <UserPlus size={18} /> {t('tentries.admin_add_title')}
          </PrimaryButton>
        </>
      )}

      {error && <p className="text-sm text-red-600 font-extrabold">{error}</p>}

      <p className="text-xs text-muted">
        {t('tentries.count_line', { confirmed, total: rows.length })}
        {category.slots ? ` · ${t('tentries.count_slots', { count: category.slots })}` : ''}
      </p>

      {shown.length === 0 ? (
        <EmptyState icon={UserPlus} title={t('tentries.empty_title')} subtitle={t('tentries.empty_subtitle')} />
      ) : (
        <div className="space-y-1.5">
          {shown.map((e) => (
            <div key={e.id || e.entry_id} className={`card flex items-center gap-3 py-3 ${
              (e.withdrawn || e.status === 'desistiu') ? 'opacity-60' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold text-ink-900 truncate">
                  {e.team_name || pairName(e, t)}
                </p>
                <p className="text-xs text-muted truncate">
                  {[
                    e.team_name ? pairName(e, t) : null,
                    e.status === 'suplente' && e.waitlist_order ? t('tentries.waitlist_n', { n: e.waitlist_order }) : null,
                    (e.player2_is_guest || (!e.player2_id && e.guest_name)) ? t('partner.no_account_tag') : null,
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
                  {e.has_invite && !e.player2_id && (
                    <button
                      onClick={() => share(e)}
                      disabled={busy}
                      aria-label={t('tentries.invite_again')}
                      className="press flex h-9 w-9 items-center justify-center rounded-full bg-ink-50 text-ink-900"
                    >
                      <Send size={16} />
                    </button>
                  )}
                  {e.status === 'por_validar' && (
                    <button
                      onClick={() => act(() => validateEntry(e.entry_id, true))}
                      disabled={busy}
                      aria-label={t('tentries.validate')}
                      className="press flex h-9 w-9 items-center justify-center rounded-full bg-lime-400 text-ink-900"
                    >
                      <Check size={18} />
                    </button>
                  )}
                  <button
                    onClick={() => window.confirm(t('tentries.remove_confirm')) && act(() => removeEntry(e.entry_id))}
                    disabled={busy}
                    aria-label={t('tentries.remove')}
                    className="press flex h-9 w-9 items-center justify-center rounded-full bg-ink-50 text-muted"
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <AdminEntrySheet
          organizationId={tournament.organization_id}
          categoryId={category.id}
          busy={busy}
          error={error}
          onConfirm={async (choice) => { await act(() => adminSignUp(choice)); setAddOpen(false) }}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  )
}
