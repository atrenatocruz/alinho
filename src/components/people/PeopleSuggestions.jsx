// «Sugestões» por baixo de uma pesquisa de pessoas, antes de se escrever
// (Francisco, 12 out): com quem mais joguei, quem sigo e me segue, e gente dos
// meus grupos ou clubes — com foto, nível e a razão pequena por baixo. Tocar
// junta a pessoa. Peça comum: o «Novo jogo entre amigos» (Bugs) e a escolha
// de parceiro no mix e no jogo em aberto (Dev 2).
//
// Props:
//   onPick(person)   — { id, name, avatar_url, rating, gender }
//   exclude          — ids que já estão escolhidos (não aparecem)
//   orgId            — só gente desse grupo/clube (jogo de grupo, mix de um clube)
//   onlyIds          — opcional: só estes ids (quando quem chama já tem a lista
//                      dos membros e a função ainda não filtra por grupo)
//   limit            — quantas mostrar (6 por omissão; pede mais para sobrar
//                      depois de tirar os excluídos)
// Privacidade: a função manda os perfis privados sem nível nem género (sem
// seguir mútuo); ninguém desaparece por ser privado.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { Avatar, RatingBadge } from '../ui'
import { suggestPartners } from '../../lib/suggestPartners'

export function reasonText(t, p) {
  if (p.reason === 'jogaram_juntos') {
    return p.reason_count ? t('suggest.played_together', { count: p.reason_count }) : t('suggest.played_together_some')
  }
  if (p.reason === 'seguem_se') return t('suggest.follow_each_other')
  if (p.reason === 'mesmo_clube') return p.org_name ? t('suggest.same_club', { name: p.org_name }) : t('suggest.same_club_some')
  return ''
}

export default function PeopleSuggestions({ onPick, exclude = [], orgId = null, onlyIds = null, limit = 6 }) {
  const { t } = useTranslation()
  const [list, setList] = useState(null)
  useEffect(() => {
    let alive = true
    suggestPartners({ limit: limit + 6, orgId })
      .then((rows) => { if (alive) setList(rows) })
      .catch((err) => { console.error('Error loading suggestions:', err); if (alive) setList([]) })
    return () => { alive = false }
  }, [limit, orgId])
  const skip = new Set(exclude.filter(Boolean))
  const shown = (list || [])
    .filter((p) => !skip.has(p.id) && (!onlyIds || onlyIds.has(p.id)))
    .slice(0, limit)
  if (!shown.length) return null
  return (
    <div className="mt-3">
      {/* Na mesma letra de «Quem joga · N» (UX, 12 out). */}
      <p className="mb-2 block text-sm font-medium text-gray-700">{t('suggest.title')}</p>
      <div className="overflow-hidden rounded-ctrl border border-line bg-white">
        {shown.map((p) => (
          <div key={p.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
            <Avatar name={p.name} url={p.avatar_url} size="w-9 h-9 text-[11px]" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-ink-900">{p.name}</span>
                <RatingBadge rating={p.rating} gender={p.gender} />
              </span>
              {reasonText(t, p) && <span className="block truncate text-xs text-muted">{reasonText(t, p)}</span>}
            </span>
            <button type="button" aria-label={t('friends.add_person', { name: p.name })}
              onClick={() => onPick({ id: p.id, name: p.name, avatar_url: p.avatar_url, rating: p.rating, gender: p.gender })}
              className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink-900 text-white">
              <Plus size={18} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
