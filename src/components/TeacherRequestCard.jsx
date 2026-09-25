import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { makeClubAdmin, resolveTeacherClub } from '../lib/teachers'
import { describeError } from '../lib/errors'
import { Avatar, ConfirmSheet } from './ui'

/* ─── Pedido de professor no Gerir › Pessoas (desenho aprovado 25 set,
   design-handoff/2026-09-25-professores-proposta, assunto 2) ───────────────
   - A linha de estado vai inteira (pode ir a duas linhas, nunca cortada).
   - «Aceitar» a preto, «Recusar» a contorno: numa lista o lima repetia-se.
   - Sai a caixa «Dar também papel de admin»: depois de aceitar (já feito),
     a janela de baixo pergunta, com «Agora não» primeiro.
   - «Recusar» pergunta antes. Erros no cartão, nada de alert(). */
export default function TeacherRequestCard({ req, organizationId, onResolved }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [asking, setAsking] = useState(null) // 'reject' | 'admin' | null
  // «Correu bem»: tira preta de 3 s. Vai para o <body> (portal) porque o
  // conteúdo do Gerir tem uma animação com transform, que prende os
  // elementos «fixed» a ele e os deixava fora do ecrã.
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => { setNotice(''); onResolved?.() }, 3000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice])
  const female = req.user?.gender === 'feminino'
  const g = (key) => t(female ? `${key}_f` : key)
  const fullName = req.user?.name || t('gerirclube.fallback_player_name')
  const name = fullName.split(' ')[0]

  const accept = async () => {
    setBusy(true); setError('')
    try {
      await resolveTeacherClub(req.id, true, false)
      setAsking('admin')
    } catch (err) {
      console.error('Error accepting club teacher:', err)
      setError(describeError(t, err, 'gerirclube.error_approve_teacher_request'))
    } finally {
      setBusy(false)
    }
  }
  const finish = (admin) => {
    setAsking(null)
    setNotice(t(female ? 'gerirclube.teacher_accepted_f' : 'gerirclube.teacher_accepted', { name: fullName })
      + (admin ? t('gerirclube.teacher_accepted_admin') : '.'))
  }
  const becomeAdmin = async () => {
    setBusy(true); setError('')
    try {
      await makeClubAdmin(organizationId, req.user_id)
      finish(true)
    } catch (err) {
      console.error('Error making teacher admin:', err)
      setError(describeError(t, err, 'gerirclube.error_update_permissions'))
    } finally {
      setBusy(false)
    }
  }

  // Aceite: o cartão sai logo da lista e fica só a tira; a lista recarrega
  // quando a tira sai.
  if (notice) {
    return createPortal(
      <div role="status" className="fixed left-4 right-4 bottom-[104px] z-50 mx-auto max-w-md bg-ink-900 text-white px-4 py-3 rounded-ctrl text-sm font-extrabold flex items-center gap-2 animate-fade-up">
        <Check size={16} className="shrink-0" />
        {notice}
      </div>,
      document.body,
    )
  }

  const btn = 'flex-1 inline-flex items-center justify-center min-h-[44px] rounded-full text-sm font-extrabold disabled:opacity-40'

  return (
    <div className="card space-y-2.5">
      <div className="flex items-center gap-3">
        <Avatar name={fullName} url={req.user?.avatar_url} size="w-10 h-10 text-sm" />
        <p className="flex-1 min-w-0 font-extrabold text-ink-900 truncate">{fullName}</p>
      </div>
      <p className="text-sm text-ink-900 leading-snug">
        {req.status === 'approved' ? g('gerirclube.teacher_verified') : g('gerirclube.teacher_being_verified')}
      </p>
      <p className="text-xs text-muted break-words">{[req.zone, req.contact].filter(Boolean).join(' · ')}</p>
      {error && <p role="alert" className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-bold text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={accept} className={`${btn} bg-ink-900 text-white hover:bg-ink-700`}>
          {t('gerirclube.teacher_accept')}
        </button>
        <button type="button" disabled={busy} onClick={() => setAsking('reject')} className={`${btn} border-[1.5px] border-line bg-white text-ink-900 hover:bg-ink-50`}>
          {t('gerirclube.teacher_reject')}
        </button>
      </div>

      <ConfirmSheet
        open={asking === 'reject'}
        danger
        title={t(female ? 'gerirclube.teacher_reject_title_f' : 'gerirclube.teacher_reject_title', { name })}
        message={g('gerirclube.teacher_reject_text')}
        cancelLabel={t('gerirclube.teacher_reject_keep')}
        confirmLabel={t('gerirclube.teacher_reject_confirm')}
        onConfirm={async () => { await resolveTeacherClub(req.id, false); onResolved?.() }}
        onClose={() => setAsking(null)}
        errorOf={(err) => describeError(t, err, 'gerirclube.error_reject_teacher_request')}
      />

      {/* Depois de «Aceitar»: a aceitação já está feita, por isso «Agora não»
          vem primeiro e a preto, e não desfaz nada. */}
      {asking === 'admin' && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="teacher-admin-title"
            className="w-full max-w-md rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-lift sm:rounded-[24px]">
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-ink-200" />
            <p id="teacher-admin-title" className="text-[20px] font-extrabold leading-tight text-ink-900">
              {t(female ? 'gerirclube.teacher_admin_title_f' : 'gerirclube.teacher_admin_title', { name })}
            </p>
            <p className="mt-2 text-[15px] leading-snug text-ink-500">{g('gerirclube.teacher_admin_text')}</p>
            {error && <p role="alert" className="mt-3 rounded-ctrl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">{error}</p>}
            <div className="mt-5 space-y-2.5">
              <button type="button" disabled={busy} onClick={() => finish(false)}
                className="w-full min-h-[52px] rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
                {t('gerirclube.teacher_admin_no')}
              </button>
              <button type="button" disabled={busy} onClick={becomeAdmin}
                className="w-full min-h-[52px] rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
                {t('gerirclube.teacher_admin_yes')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

    </div>
  )
}
