// «Nome da dupla» — a janela de mudar o nome depois da inscrição
// (design-handoff/2026-09-27-nome-da-dupla, aprovado pelo Francisco a 27 set).
// A mesma para os dois da dupla (no cartão da inscrição) e para o
// organizador (nas opções da dupla). Quem pode, e até quando, decide o
// servidor (rename_tournament_entry, Dev 3): aqui só se diz o que ele disse.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Sheet } from '../agenda/AgendaControls'
import { FieldLabel } from './TournamentBits'
import { renameTournamentEntry } from '../../lib/tournamentApi'
import { errorCode } from '../../lib/errors'

export default function TeamNameSheet({ entryId, initial = '', onClose, onSaved }) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true); setError('')
    try {
      const saved = await renameTournamentEntry(entryId, name)
      onSaved(saved ?? (name.trim() || null))
    } catch (err) {
      console.error('Error renaming the team:', err)
      const code = errorCode(err)
      setError(t(code === 'entries_closed' ? 'tteamname.error_closed' : code === 'not_allowed' ? 'tteamname.error_not_allowed' : 'tteamname.error'))
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('tteamname.title')} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <FieldLabel>{t('tsignup.team_name_label')}</FieldLabel>
          <div className="relative">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
              placeholder={t('tsignup.team_name_placeholder')} className="input-field pr-12" />
            {name && (
              <button type="button" onClick={() => setName('')} aria-label={t('tentries.search_clear')}
                className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-muted">
                <X size={18} />
              </button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted">{t('tteamname.hint')}</p>
        </div>
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        <button type="button" onClick={save} disabled={busy}
          className="inline-flex min-h-[48px] w-full items-center justify-center rounded-ctrl bg-ink-900 px-5 text-base font-extrabold text-white disabled:opacity-40">
          {t('tteamname.save')}
        </button>
        <button type="button" onClick={onClose} className="min-h-[44px] w-full text-sm font-extrabold text-ink-700">
          {t('common.back')}
        </button>
      </div>
    </Sheet>
  )
}
