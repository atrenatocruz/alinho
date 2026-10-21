// «Trocar por uma conta» (Francisco, 19 out, dos casos do Mix M5 de segunda):
// um convidado que entrou só pelo nome («In com Ricardo Delca») passa a ser a
// conta dessa pessoa. Quem organiza escolhe a conta entre os membros do grupo
// (os de nome parecido em cima) ou pela pesquisa de pessoas, como no «In com».
// A troca é do Dev 3 (admin_swap_guest_for_account): o lugar e a dupla passam
// para a conta; os pontos já feitos não. Quem chama recarrega o mix.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Sheet } from '../agenda/AgendaControls'
import { Avatar, ConfirmSheet } from '../ui'
import { searchPlayers } from '../../lib/privateMatches'
import { contemTexto } from '../../lib/semAcentos'
import { describeError } from '../../lib/errors'

const SWAP_ERRORS = ['not_allowed', 'not_found', 'bad_status', 'already_in_game']

/** O nome sem acentos nem maiúsculas, para pôr em cima quem se chama igual. */
const plain = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

export default function SwapGuestSheet({ game, guest, excludeIds, onClose, onSwapped }) {
  const { t } = useTranslation()
  const [members, setMembers] = useState([])
  const [query, setQuery] = useState('')
  const [found, setFound] = useState([])
  const [chosen, setChosen] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    let alive = true
    supabase
      .from('memberships')
      .select('user_id, profile:profiles(id, name, avatar_url)')
      .eq('organization_id', game.organization_id)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) { console.error('Error loading members to swap a guest:', error); return }
        setMembers((data || []).filter((m) => m.profile).map((m) => ({ id: m.user_id, name: m.profile.name || '?', avatar_url: m.profile.avatar_url })))
      })
    return () => { alive = false }
  }, [game.organization_id])

  // Fora do grupo: a pesquisa de pessoas, como no «In com».
  useEffect(() => {
    clearTimeout(timer.current)
    const q = query.trim()
    if (q.length < 2) { setFound([]); return undefined }
    timer.current = setTimeout(() => {
      searchPlayers(q).then(setFound).catch((err) => console.error('Error searching players:', err))
    }, 300)
    return () => clearTimeout(timer.current)
  }, [query])

  const list = useMemo(() => {
    const q = query.trim()
    const guestName = plain(guest.name)
    const pool = members.filter((m) => !excludeIds.has(m.id) && (!q || contemTexto(m.name, q)))
    const outside = found.filter((p) => !excludeIds.has(p.id) && !pool.some((m) => m.id === p.id))
    // Quem tem o mesmo nome do convidado aparece primeiro, com «Mesmo nome» (UX, 19 out).
    const same = (m) => plain(m.name) === guestName
    return [...pool, ...outside].sort((a, b) => Number(same(b)) - Number(same(a)) || a.name.localeCompare(b.name, 'pt')).slice(0, 12)
      .map((m) => ({ ...m, sameName: same(m) }))
  }, [members, found, query, guest.name, excludeIds])

  const swap = async () => {
    const { data, error } = await supabase.rpc('admin_swap_guest_for_account', {
      p_game_id: game.id, p_guest_id: guest.id, p_user_id: chosen.id,
    })
    if (error) throw error
    // Sem lugar nem dupla mexidos: o convidado já não estava no mix.
    if (data && !data.participants && !data.teams) throw new Error('not_found')
    onSwapped?.(chosen)
  }
  const errorText = (err) => {
    const code = SWAP_ERRORS.find((c) => String(err?.message || '').includes(c))
    return code ? t(`swapguest.error_${code}`) : describeError(t, err, 'swapguest.error')
  }

  return (
    <>
      <Sheet title={t('swapguest.title', { name: guest.name })} onClose={onClose}>
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('swapguest.hint')}</p>
          <label className="flex items-center gap-2 input-field focus-within:border-ink-500">
            <Search size={16} className="text-muted shrink-0" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('swapguest.search_placeholder')}
              className="flex-1 min-w-0 bg-transparent outline-none text-base" />
          </label>
          <div className="space-y-1">
            {list.map((m) => (
              <button key={m.id} type="button" onClick={() => setChosen(m)}
                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-ctrl text-left ${m.sameName ? 'bg-lime-100 ring-2 ring-lime-400' : 'hover:bg-ink-50'}`}>
                <Avatar name={m.name} url={m.avatar_url} size="w-9 h-9 text-xs" />
                <span className="block min-w-0 flex-1 truncate text-sm font-extrabold text-ink-900">{m.name}</span>
                {m.sameName
                  ? <span className="shrink-0 rounded-full bg-lime-400 px-2 py-0.5 text-[11px] font-extrabold text-ink-900">{t('swapguest.same_name')}</span>
                  : <span className="shrink-0 text-[18px] text-[#8A8E95]" aria-hidden="true">›</span>}
              </button>
            ))}
            {list.length === 0 && <p className="rounded-ctrl bg-[#F4F5F1] px-3.5 py-3 text-sm text-ink-700">{t('swapguest.nobody')}</p>}
          </div>
        </div>
      </Sheet>
      <ConfirmSheet
        open={!!chosen}
        title={chosen ? t('swapguest.confirm_title', { guest: guest.name, name: chosen.name }) : ''}
        message={t('swapguest.confirm_message')}
        confirmLabel={t('swapguest.confirm')}
        cancelLabel={t('swapguest.keep')}
        onConfirm={swap}
        onClose={() => setChosen(null)}
        errorOf={errorText}
      />
    </>
  )
}
