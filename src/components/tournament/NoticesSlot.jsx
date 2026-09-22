import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Megaphone, Pencil, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { PrimaryButton } from '../ui'
import { Sheet } from '../agenda/AgendaControls'
import {
  activeNotices, noticeAge, noticeError, NOTICE_MAX,
  publishNotice, updateNotice, deleteNotice,
} from '../../lib/tournamentNotices'

/* Avisos do organizador (Trello #366) — o slot `top` da página do torneio.

   Desenho: wireframes/torneio.html, «Quem chega de fora, e os avisos do
   organizador». Regras que se veem à vista:
   • um escreve, todos leem, **ninguém responde** — não há caixa de
     resposta nenhuma, nem gosto, nem nada. É de propósito;
   • sobe acima de tudo, também para quem não tem conta;
   • **sem aviso não fica espaço reservado** — este componente devolve
     null e a página não muda de forma.

   As funções que gravam são do Dev 3 (a base de dados dos torneios é
   dele). Enquanto não existirem, publicar avisa que ainda não está
   pronto, em vez de dar erro. */

function NoticeComposer({ tournament, editing, busy, error, onSave, onClose }) {
  const { t } = useTranslation()
  const [body, setBody] = useState(editing?.body || '')
  const [alsoWhatsapp, setAlsoWhatsapp] = useState(false)
  const [touched, setTouched] = useState(false)
  const problem = noticeError(body)

  return (
    <Sheet onClose={onClose} title={t(editing ? 'tnotices.edit_title' : 'tnotices.new_title')}>
      <div className="space-y-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={NOTICE_MAX + 40}
          placeholder={t('tnotices.placeholder')}
          className="input-field resize-none"
          autoFocus
        />
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{t('tnotices.no_replies_hint')}</span>
          <span className={body.length > NOTICE_MAX ? 'text-red-600 font-extrabold' : ''}>
            {body.length}/{NOTICE_MAX}
          </span>
        </div>
        {touched && problem && (
          <p className="text-sm text-red-600 font-extrabold">{t(`tnotices.error_${problem}`)}</p>
        )}

        {/* Pode ir também para o grupo de WhatsApp, onde ele exista. */}
        {!editing && (
          <label className="flex items-center gap-2.5 text-sm font-semibold text-ink-900">
            <input
              type="checkbox"
              checked={alsoWhatsapp}
              onChange={(e) => setAlsoWhatsapp(e.target.checked)}
              className="h-5 w-5 rounded"
            />
            {t('tnotices.also_whatsapp')}
          </label>
        )}

        {error && <p className="text-sm text-red-600 font-extrabold">{error}</p>}

        <PrimaryButton
          onClick={() => { setTouched(true); if (!problem) onSave({ body, alsoWhatsapp }) }}
          disabled={busy || !!problem}
          className="w-full"
        >
          {t(editing ? 'tnotices.save' : 'tnotices.publish')}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}

export default function NoticesSlot({ tournament }) {
  const { t } = useTranslation()
  const { adminOrganizations } = useAuth()
  const isAdmin = (adminOrganizations || []).some?.((o) => (o.id || o) === tournament.organization_id)
  const [composer, setComposer] = useState(null) // null | 'new' | notice
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notices, setNotices] = useState([])

  // Os avisos vêm da vista pública (abre sem conta), não das props: assim
  // este painel não obriga o esqueleto do Dev 1 a passar mais nada, e pode
  // recarregar-se sozinho depois de publicar.
  const load = useCallback(() => {
    supabase
      .from('tournament_public_notices')
      .select('id, body, created_at, author_name')
      .eq('tournament_id', tournament.id)
      .then(({ data, error: err }) => {
        // Sem a vista (base de dados por migrar) fica simplesmente vazio.
        if (err) { console.error('Error loading tournament notices:', err); return }
        setNotices(data || [])
      })
  }, [tournament.id])
  useEffect(load, [load])

  const rows = activeNotices(notices)

  // Sem avisos e sem ser admin, isto não existe — nem uma linha.
  if (rows.length === 0 && !isAdmin) return null

  const say = (err) => setError(t(err?.message === 'not_ready' ? 'tnotices.error_not_ready' : 'tnotices.error_generic'))
  const reload = () => { load(); window.dispatchEvent(new CustomEvent('tournament:reload')) }

  const save = async ({ body, alsoWhatsapp }) => {
    setBusy(true); setError('')
    try {
      if (composer === 'new') await publishNotice({ tournamentId: tournament.id, body, alsoWhatsapp })
      else await updateNotice({ noticeId: composer.id, body })
      setComposer(null)
      reload()
    } catch (err) { console.error('Error saving tournament notice:', err); say(err) }
    finally { setBusy(false) }
  }

  const remove = async (notice) => {
    if (!window.confirm(t('tnotices.delete_confirm'))) return
    setBusy(true); setError('')
    try {
      await deleteNotice(notice.id)
      reload()
    } catch (err) { console.error('Error deleting tournament notice:', err); say(err) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-2">
      {rows.map((notice) => {
        const age = noticeAge(notice.created_at)
        return (
          <div key={notice.id} className="rounded-card border-2 border-[#C9C3F3] bg-[#E9E7FB] px-3.5 py-3">
            <div className="flex gap-2.5">
              <Megaphone size={18} className="mt-0.5 shrink-0 text-[#4338A8]" />
              <div className="min-w-0 flex-1">
                <p className="font-extrabold text-ink-900">{notice.body}</p>
                <p className="mt-0.5 text-xs text-[#4338A8]">
                  {[notice.author_name || tournament.club_name, age ? t(age.key, age.values) : null]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
              {isAdmin && (
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => { setError(''); setComposer(notice) }}
                    aria-label={t('tnotices.edit_title')}
                    className="press flex h-8 w-8 items-center justify-center rounded-full text-[#4338A8] hover:bg-white/60"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => remove(notice)}
                    disabled={busy}
                    aria-label={t('tnotices.delete')}
                    className="press flex h-8 w-8 items-center justify-center rounded-full text-[#4338A8] hover:bg-white/60"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Só o organizador escreve. Quem joga lê — e mais nada. */}
      {isAdmin && (
        <button
          onClick={() => { setError(''); setComposer('new') }}
          className="press flex w-full items-center justify-center gap-2 rounded-ctrl border-2 border-dashed border-line py-2.5 text-sm font-extrabold text-ink-900"
        >
          <Megaphone size={16} /> {t('tnotices.new_title')}
        </button>
      )}

      {error && !composer && (
        <div className="flex items-start gap-2 rounded-ctrl bg-ink-50 px-3 py-2">
          <p className="flex-1 text-sm text-ink-900">{error}</p>
          <button onClick={() => setError('')} aria-label={t('ui.close')} className="press text-muted"><X size={16} /></button>
        </div>
      )}

      {composer && (
        <NoticeComposer
          tournament={tournament}
          editing={composer === 'new' ? null : composer}
          busy={busy}
          error={error}
          onSave={save}
          onClose={() => { setComposer(null); setError('') }}
        />
      )}
    </div>
  )
}
