import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { Chips, ConfirmSheet, PrimaryButton } from '../ui'
import { Sheet } from '../agenda/AgendaControls'
import { whatsappShare } from '../../lib/partnerInvite'
import TournamentSignupSheet from './TournamentSignupSheet'
import PublicInfo from './PublicInfo'
import {
  signUp, respondToInvite, listMyInvites, withdrawEntry,
  entriesOpen, categoriesLeft, tournamentInviteLink, canScoreTournament,
} from '../../lib/tournamentSignup'
import { signUpBackLink } from '../../lib/loginLinks'
import { signupErrorMessage } from '../../lib/tournamentError'
import { categoryGenderQuestion } from './genderCheck'

/* O que fica por cima de tudo na página do torneio (Trello #362):
   inscrever a minha dupla, em que ponto está a minha inscrição, e o
   pedido do parceiro à minha espera.

   Mora no slot `top` de panels.js — é o sítio que o desenho dá ao
   "Inscrever a minha dupla" (logo debaixo do cartaz) e onde depois
   entram os avisos do organizador (Torneio 6/6, mesmo ficheiro). */

const STATE_KEY = {
  convite: 'tsignup.state_waiting_partner',
  sem_parceiro: 'tsignup.state_alone',
  por_validar: 'tsignup.state_to_validate',
  validada: 'tsignup.state_in',
  selecionada: 'tsignup.state_in',
  suplente: 'tsignup.state_waitlist',
}

export default function SignupSlot({ tournament, categories, category, my: firstEntry, myEntries = [] }) {
  const { t } = useTranslation()
  const { user, profile, updateProfile } = useAuth()
  const [genderSheet, setGenderSheet] = useState(false)
  const [invites, setInvites] = useState([])
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fresh, setFresh] = useState(null) // convite acabado de criar
  const [askLeave, setAskLeave] = useState(false)
  // O sexo não bate com a categoria: pergunta-se, não se bloqueia (26 set).
  const [genderAsk, setGenderAsk] = useState(null) // { key, then }

  const reloadInvites = () => {
    if (!user) return
    listMyInvites()
      .then((rows) => setInvites(rows.filter((r) => r.tournament_id === tournament.id)))
      .catch((err) => console.error('Error loading tournament invites:', err))
  }
  useEffect(reloadInvites, [user, tournament.id])

  // Quem marca resultados vê o caminho para a página de marcar, a partir do
  // sorteio (Trello #487). Antes só havia link no Gerir, para quem organiza.
  const scoringOpen = ['sorteado', 'a_decorrer'].includes(tournament.status)
  const [canScore, setCanScore] = useState(false)
  useEffect(() => {
    if (!user || !scoringOpen) { setCanScore(false); return }
    let cancelled = false
    canScoreTournament(tournament.id)
      .then((ok) => { if (!cancelled) setCanScore(ok) })
      .catch(() => { if (!cancelled) setCanScore(false) })
    return () => { cancelled = true }
  }, [user, tournament.id, scoringOpen])

  const open = entriesOpen(tournament, null)
  const left = categoriesLeft(tournament, myEntries)
  // A inscrição que se mostra é a da categoria escolhida. Se não estou
  // nela e ainda posso ir a mais uma, aparece o botão de inscrever; se já
  // não posso, mostra-se a que tenho (Trello #451).
  const my = myEntries.find((e) => e.category_id === category?.id)
    || (left === 0 ? firstEntry : null)
  // Quem chega do WhatsApp sem conta carrega em «Criar conta para me
  // inscrever» e tem de aterrar no separador de CRIAR CONTA — e voltar a
  // esta categoria depois de a criar (Trello #454). O mecanismo ja existe
  // e é o mesmo dos convites de jogo privado: o Guard do App.jsx manda
  // /login?redirect=<pagina> e o AfterLogin devolve a pessoa la. O botao
  // é que ia para um /login pelado: abria em «Entrar» e, feita a conta,
  // largava a pessoa na Home sem o torneio.
  const signUpHref = () => signUpBackLink({
    pathname: window.location.pathname,
    search: window.location.search,
    categoryCode: category?.code,
  })

  // A mesma conta do lado do organizador, agora num sítio só. A versão que
  // estava aqui não contava com algarismos (`[a-z_]+`), por isso
  // `player1_gender_required` ficava-se por `_gender_required` — chave que
  // não existe — e quem se inscrevia sem género lia «Não foi possível. Tenta
  // outra vez.» em vez de «falta escolher o género» (Trello #476).
  const say = (err) => setError(signupErrorMessage(t, err))

  const doSignUp = async (choice) => {
    setBusy(true); setError('')
    try {
      const result = await signUp(choice)
      setSheet(false)
      if (result?.invite_token) setFresh({ name: choice.guestName, email: choice.guestEmail, token: result.invite_token, waitlist: result.status === 'suplente' })
      window.dispatchEvent(new CustomEvent('tournament:reload'))
    } catch (err) { console.error('Error signing up for tournament:', err); say(err) }
    finally { setBusy(false) }
  }

  // Sem género no perfil pergunta-se ali mesmo, com «Agora não»: o sexo
  // nunca bloqueia (Francisco, 26 set; antes era obrigatório, #433).
  const startSignUp = () => {
    setError('')
    if (!profile?.gender) setGenderSheet(true)
    else setSheet(true)
  }
  const chooseGender = async (gender) => {
    setBusy(true)
    const { error: err } = await updateProfile({ gender })
    setBusy(false)
    if (err) { console.error('Error saving gender:', err); say(err); return }
    setGenderSheet(false)
    setSheet(true)
  }
  // Antes de gravar: se o sexo da dupla não bate com a categoria, pergunta.
  const trySignUp = (choice) => {
    const key = categoryGenderQuestion(categories.find((c) => c.id === choice.categoryId), [profile?.gender, choice.partnerGender])
    if (key) setGenderAsk({ key, then: () => doSignUp(choice) })
    else doSignUp(choice)
  }

  const answer = async (entryId, accept) => {
    setBusy(true)
    try {
      await respondToInvite(entryId, accept)
      reloadInvites()
      window.dispatchEvent(new CustomEvent('tournament:reload'))
    } catch (err) { console.error('Error answering tournament invite:', err); say(err) }
    finally { setBusy(false) }
  }

  // Desistir pergunta na folha da app, não na caixa do telemóvel (#435).
  // Se falhar, o erro fica na folha, junto ao botão que falhou.
  const leave = async () => {
    await withdrawEntry(my.entry_id)
    // Depois de gravada: se recarregar a página falhar, isso não é «não
    // conseguiste desistir» — a desistência já está feita (Trello #429).
    window.dispatchEvent(new CustomEvent('tournament:reload'))
  }

  const link = fresh ? tournamentInviteLink(fresh.token, window.location.origin) : ''

  return (
    <div className="space-y-2.5">
      {canScore && (
        <div className="card flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm font-semibold text-ink-900">{t('tournament.score.link_title')}</p>
          <Link to={`/torneio/${tournament.slug || tournament.id}/marcar`}
            className="btn-secondary shrink-0 !px-4 inline-flex items-center">
            {t('tournament.score.link_cta')}
          </Link>
        </div>
      )}

      {/* Pedido do parceiro à minha espera — o mais urgente fica em cima. */}
      {invites.map((inv) => (
        <div key={inv.entry_id} className="card space-y-2">
          <p className="font-extrabold text-ink-900">{t('tsignup.invite_title', { name: inv.inviter_name })}</p>
          <p className="text-sm text-muted">
            {[inv.category_code, inv.respond_by ? t('tsignup.invite_deadline', { date: new Date(inv.respond_by).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }) }) : null]
              .filter(Boolean).join(' · ')}
          </p>
          <div className="flex gap-2">
            <PrimaryButton onClick={() => answer(inv.entry_id, true)} disabled={busy} className="flex-1">
              {t('tsignup.invite_accept')}
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={() => answer(inv.entry_id, false)} disabled={busy} className="flex-1">
              {t('tsignup.invite_decline')}
            </PrimaryButton>
          </div>
        </div>
      ))}

      {/* A minha inscrição, ou o convite para me inscrever. */}
      {my ? (
        <div className="card flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-extrabold text-ink-900">{t(STATE_KEY[my.state] || 'tsignup.state_in')}</p>
            {my.state === 'suplente' && <p className="text-sm text-muted">{t('tsignup.state_waitlist_hint')}</p>}
          </div>
          {open && (
            <button onClick={() => setAskLeave(true)} disabled={busy} className="press text-sm font-extrabold text-ink-900 underline shrink-0">
              {t('tsignup.withdraw')}
            </button>
          )}
        </div>
      ) : open && user ? (
        <PrimaryButton onClick={startSignUp} disabled={left === 0} className="w-full">
          {left === 0 ? t('tsignup.max_categories') : t('tsignup.cta')}
        </PrimaryButton>
      ) : open && !user ? (
        // Sem conta vê-se tudo menos inscrever (SPEC §4.10).
        <PrimaryButton onClick={() => { window.location.href = signUpHref() }} className="w-full">
          {t('tsignup.cta_signed_out')}
        </PrimaryButton>
      ) : null}

      {error && !sheet && <p className="text-sm text-danger font-extrabold">{error}</p>}

      {/* O cartaz: categorias com dia e hora, pagamento, mapa e quem
          organiza — SEMPRE, também em rascunho (pré-visualização) e depois
          do fecho, que é quando se joga (QA, 26 set). Só as vagas e o botão
          de inscrever dependem das inscrições abertas. */}
      <PublicInfo tournament={tournament} categories={categories} entriesOpen={open} />

      {genderSheet && (
        <Sheet title={t('tsignup.gender_title')} onClose={() => setGenderSheet(false)}>
          <div className="space-y-3">
            <p className="text-sm text-ink-900">{t('tsignup.gender_body')}</p>
            {/* Uma resposta, não duas ações: pastilhas, sem lima (revisão da
                designer, 26 set). */}
            <Chips
              label={t('tsignup.gender_title')}
              value={null}
              onChange={(g) => { if (!busy) chooseGender(g) }}
              options={[
                { value: 'masculino', label: t('login.gender_male') },
                { value: 'feminino', label: t('login.gender_female') },
              ]}
            />
            <button type="button" onClick={() => { setGenderSheet(false); setSheet(true) }} disabled={busy}
              className="w-full min-h-[44px] text-sm font-extrabold text-ink-900 underline underline-offset-2">
              {t('gamedetails.gender_skip')}
            </button>
            {error && <p className="text-sm text-danger font-extrabold">{error}</p>}
          </div>
        </Sheet>
      )}

      {sheet && (
        <TournamentSignupSheet
          tournament={tournament}
          categories={categories}
          category={category}
          categoriesLeft={left}
          busy={busy}
          error={error}
          onConfirm={trySignUp}
          onClose={() => { setSheet(false); setError('') }}
        />
      )}

      {/* Inscreveu alguém sem conta: o link é como ele fica a saber. */}
      {fresh && (
        <Sheet title={t('tsignup.invite_ready_title')} onClose={() => setFresh(null)}>
          <div className="space-y-3">
            <p className="text-sm text-ink-900">{t('tsignup.invite_ready_body', { name: fresh.name })}</p>
            {fresh.waitlist && <p className="text-sm font-semibold text-ink-900">{t('tsignup.invite_ready_waitlist')}</p>}
            <p className="text-sm text-muted">
              {fresh.email ? t('partner.invite_ready_email', { email: fresh.email }) : t('partner.invite_ready_no_email')}
            </p>
            <div className="rounded-ctrl bg-ink-50 px-3 py-2 text-xs text-ink-900 break-all">{link}</div>
            <PrimaryButton
              onClick={() => window.open(whatsappShare(t('tsignup.invite_whatsapp_text', { name: fresh.name, title: tournament.name, link })), '_blank')}
              className="w-full"
            >
              {t('partner.invite_send_whatsapp')}
            </PrimaryButton>
            <PrimaryButton
              variant="ghost"
              onClick={() => navigator.clipboard?.writeText(link)}
              className="w-full"
            >
              <Copy size={18} /> {t('partner.invite_copy_link')}
            </PrimaryButton>
          </div>
        </Sheet>
      )}
      <ConfirmSheet
        open={!!genderAsk}
        title={genderAsk ? t(genderAsk.key) : ''}
        message={t('tsignup.gender_confirm_message')}
        confirmLabel={t('tsignup.gender_confirm_yes')}
        cancelLabel={t('gamedetails.gender_confirm_cancel')}
        onConfirm={() => { const next = genderAsk?.then; setGenderAsk(null); if (next) next() }}
        onClose={() => setGenderAsk(null)}
      />
      <ConfirmSheet
        open={askLeave}
        danger
        title={t('tsignup.withdraw_title', { category: category?.name || '' })}
        // Quem inscreveu a dupla leva-a toda; quem foi convidado sai sozinho.
        // `registered_by_me` vem da migração do Dev 3 — enquanto não correr,
        // não vem, e a frase diz os dois casos.
        message={t(my?.registered_by_me === true ? 'tsignup.withdraw_consequence_mine'
          : my?.registered_by_me === false ? 'tsignup.withdraw_consequence_invited'
            : 'tsignup.withdraw_consequence')}
        cancelLabel={t('tsignup.withdraw_keep')}
        confirmLabel={t('tsignup.withdraw_yes')}
        onConfirm={leave}
        onClose={() => setAskLeave(false)}
        errorOf={(err) => signupErrorMessage(t, err)}
      />
    </div>
  )
}
