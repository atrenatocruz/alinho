// «Trocar <nome>» (pacote do mix, ponto 17 — Francisco, 2 out: «sim aprovo»;
// página 9 do «como fica»): com as duplas feitas, quem organiza troca uma
// pessoa sem desfazer as duplas. Quem entra fica no mesmo lugar, na mesma
// dupla; as outras não mudam e não se volta a sortear. Primeiro os suplentes
// (1.º primeiro), depois o resto do clube ou grupo, ou alguém sem conta só
// com o nome. A troca é do servidor (swap_mix_player, Dev 3).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../agenda/AgendaControls'
import { Avatar, RatingBadge } from '../ui'
import SearchField, { matchesQuery, Realce } from '../SearchField'
import { MonoLabel } from '../tournament/TournamentBits'

export default function SwapPlayerSheet({ outName, duplaNumber, partnerName, orgKind = 'group', suplentes = [], members = [], ratingInfoById = {}, onConfirm, onClose }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [pick, setPick] = useState(null) // { id, name } | { guestName }
  const [writing, setWriting] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isClub = orgKind !== 'group'

  // A lista do clube só aparece a procurar: são muitas pessoas.
  const shownMembers = useMemo(() => (query.trim() ? members.filter((m) => matchesQuery(m.name, query)).slice(0, 20) : []), [members, query])
  const chosenName = pick?.guestName || pick?.name || ''

  const confirm = async () => {
    setBusy(true); setError('')
    try {
      await onConfirm(pick)
      onClose()
    } catch (err) {
      console.error('Error swapping a player:', err)
      const code = ['round_started', 'already_in_mix', 'not_member', 'not_in_team', 'not_allowed', 'in_pair', 'bad_input'].find((c) => (err?.message || '').includes(c))
      setError(code ? t(`mixswap.error_${code}`) : t('mixswap.error_generic'))
    } finally {
      setBusy(false)
    }
  }

  const row = (p, sub) => {
    const on = pick?.id === p.id
    return (
      <button key={p.id} type="button" onClick={() => { setPick({ id: p.id, name: p.name }); setWriting(false) }} aria-pressed={on}
        className={`flex w-full items-center gap-3 rounded-ctrl px-3 py-2.5 text-left ${on ? 'bg-ink-900 text-white' : 'bg-canvas'}`}>
        <Avatar name={p.name} url={p.avatar_url} size="w-10 h-10 text-sm" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] font-extrabold ${on ? 'text-white' : 'text-ink-900'}`}><Realce text={p.name} query={query} /></span>
          {sub && <span className={`flex items-center gap-1.5 text-xs ${on ? 'text-ink-200' : 'text-muted'}`}>{sub}</span>}
        </span>
      </button>
    )
  }

  return (
    <Sheet title={t('mixswap.title', { name: outName || t('mixswap.empty_slot') })} onClose={onClose}>
      <p className="text-sm text-ink-500">
        {partnerName ? t('mixswap.hint', { number: duplaNumber, partner: partnerName }) : t('mixswap.hint_alone', { number: duplaNumber })}
      </p>

      {suplentes.length > 0 && (
        <>
          <MonoLabel className="mt-4 mb-2">{t('mixswap.section_suplentes')}</MonoLabel>
          <div className="space-y-2">
            {suplentes.map((p, i) => row(p, <>
              {t('mixswap.suplente_n', { n: i + 1 })}
              {/* O «·» só com o nível ao lado (UX, 2 out). */}
              {ratingInfoById[p.id]?.rating != null && <> · <RatingBadge rating={ratingInfoById[p.id].rating} gender={ratingInfoById[p.id].gender} /></>}
            </>))}
          </div>
        </>
      )}

      <MonoLabel className="mt-4 mb-2">{t(isClub ? 'mixswap.section_club' : 'mixswap.section_group')}</MonoLabel>
      <SearchField value={query} onChange={setQuery} placeholder={t(isClub ? 'mixswap.search_club' : 'mixswap.search_group')} />
      {shownMembers.length > 0 && <div className="mt-2 space-y-2">{shownMembers.map((p) => row(p, null))}</div>}
      {query.trim() && shownMembers.length === 0 && <p className="mt-2 text-sm text-muted">{t('mixswap.nobody_found')}</p>}

      {writing ? (
        <input type="text" value={guestName} autoFocus maxLength={60}
          onChange={(e) => { setGuestName(e.target.value); setPick(e.target.value.trim() ? { guestName: e.target.value.trim() } : null) }}
          placeholder={t('mixswap.guest_placeholder')} className="input-field mt-3" />
      ) : (
        <p className="mt-3 text-sm text-ink-500">
          {t('mixswap.not_in_app')}{' '}
          <button type="button" onClick={() => { setWriting(true); setPick(null) }} className="font-extrabold text-ink-900 underline underline-offset-2">
            {t('mixswap.write_name')}
          </button>
        </p>
      )}

      {error && <p role="alert" className="mt-3 text-sm font-extrabold text-danger">{error}</p>}
      <button type="button" onClick={confirm} disabled={busy || !pick}
        className="mt-4 w-full min-h-[52px] rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
        {chosenName ? t('mixswap.confirm', { name: chosenName }) : t('mixswap.confirm_empty')}
      </button>
    </Sheet>
  )
}
