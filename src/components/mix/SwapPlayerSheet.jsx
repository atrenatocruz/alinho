// «Tirar <nome>» (forma nova, design-handoff/2026-10-05-mix-tirar-pessoa —
// Francisco, 6 out: «não está nada claro» com as setas). Com suplente, a
// 1.ª opção já vem escolhida («Pôr <suplente> no lugar»); «Escolher outra
// pessoa» abre a procura. A regra é a mesma do ponto 17.
// «Trocar <nome>» (pacote do mix, ponto 17 — Francisco, 2 out: «sim aprovo»;
// página 9 do «como fica»): com as duplas feitas, quem organiza troca uma
// pessoa sem desfazer as duplas. Quem entra fica no mesmo lugar, na mesma
// dupla; as outras não mudam e não se volta a sortear. Primeiro os suplentes
// (1.º primeiro), depois o resto do clube ou grupo, ou alguém sem conta só
// com o nome. A troca é do servidor (swap_mix_player, Dev 3).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../agenda/AgendaControls'
import { Search } from 'lucide-react'
import { Avatar, RatingBadge } from '../ui'
import { ratingBand } from '../../lib/elo'
import SearchField, { matchesQuery, Realce } from '../SearchField'
import { MonoLabel } from '../tournament/TournamentBits'

export default function SwapPlayerSheet({ outName, duplaNumber, partnerName, orgKind = 'group', suplentes = [], members = [], ratingInfoById = {}, onConfirm, onRemove = null, onClose }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const firstSuplente = suplentes[0] || null
  // Com suplente, ele já vem escolhido; «Escolher outra pessoa» muda o modo.
  const [mode, setMode] = useState(firstSuplente ? 'suplente' : 'other')
  const [pick, setPick] = useState(firstSuplente ? { id: firstSuplente.id, name: firstSuplente.name } : null) // { id, name } | { guestName }
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

  const suplenteSub = (p, i) => (
    <>
      {t('mixswap.suplente_n', { n: i + 1 })}
      {/* O «·» só com o nível ao lado (UX, 2 out). */}
      {ratingBand(ratingInfoById[p.id]?.rating, ratingInfoById[p.id]?.gender) && <> · <RatingBadge rating={ratingInfoById[p.id].rating} gender={ratingInfoById[p.id].gender} /></>}
    </>
  )
  // As duas opções em cartão (com suplente): a escolhida com o contorno preto.
  const option = (key, icon, title, sub, onPick) => (
    <button type="button" onClick={onPick} aria-pressed={mode === key}
      className={`flex w-full items-center gap-3 rounded-ctrl border-2 bg-white px-3 py-3 text-left ${mode === key ? 'border-ink-900' : 'border-line'}`}>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-extrabold text-ink-900">{title}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">{sub}</span>
      </span>
    </button>
  )

  return (
    <Sheet title={outName ? t('mixswap.title', { name: outName }) : t('mixswap.title_empty')} onClose={onClose}>
      <p className="text-sm text-ink-500">
        {partnerName ? t('mixswap.hint', { number: duplaNumber, partner: partnerName }) : t('mixswap.hint_alone', { number: duplaNumber })}
      </p>

      {firstSuplente && (
        <div className="mt-3 space-y-2">
          {option('suplente', <Avatar name={firstSuplente.name} url={firstSuplente.avatar_url} size="w-10 h-10 text-sm" />,
            t('mixswap.put_suplente', { name: firstSuplente.name }), suplenteSub(firstSuplente, 0),
            () => { setMode('suplente'); setWriting(false); setPick({ id: firstSuplente.id, name: firstSuplente.name }) })}
          {option('other', <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-line bg-white text-ink-900"><Search size={16} /></span>,
            t('mixswap.choose_other'), t('mixswap.choose_other_sub'),
            () => { setMode('other'); setPick(null) })}
        </div>
      )}

      {mode === 'other' && (
        <>
          {suplentes.length > 1 && (
            <>
              <MonoLabel className="mt-4 mb-2">{t('mixswap.section_suplentes')}</MonoLabel>
              <div className="space-y-2">
                {suplentes.slice(1).map((p, i) => row(p, suplenteSub(p, i + 1)))}
              </div>
            </>
          )}
          <MonoLabel className="mt-4 mb-2">{t('mixswap.who_comes_in')}</MonoLabel>
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
        </>
      )}

      {error && <p role="alert" className="mt-3 text-sm font-extrabold text-danger">{error}</p>}
      <button type="button" onClick={confirm} disabled={busy || !pick}
        className="mt-4 w-full min-h-[52px] rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
        {chosenName ? t(outName ? 'mixswap.confirm' : 'mixswap.confirm_put', { name: chosenName }) : t('mixswap.confirm_empty')}
      </button>
      {/* «Tirar sem pôr ninguém» (UX, 5 out): a dupla fica com «Falta 1». */}
      {onRemove && (
        <button type="button" onClick={onRemove} disabled={busy}
          className="mt-3 w-full min-h-[44px] text-center text-sm font-extrabold text-ink-900 underline underline-offset-2 disabled:opacity-40">
          {t('mixswap.remove_only')}
        </button>
      )}
    </Sheet>
  )
}
