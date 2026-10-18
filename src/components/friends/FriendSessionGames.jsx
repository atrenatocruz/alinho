// «↗ Partilhar com quem falta»: o botão que manda o link do jogo a quem ainda
// não respondeu (usado no FriendRounds e na página do jogo). A lista antiga
// dos jogos da sessão saiu daqui: foi substituída pelo FriendRounds.
import { useTranslation } from 'react-i18next'
import { Share2 } from 'lucide-react'
import { shareWithMissing, sessionLink } from './friendShare'
import { dayText } from './dayText'

export function ShareMissingButton({ match, creatorName }) {
  const { t, i18n } = useTranslation()
  // Num jogo que não conta, a mensagem não fala em «contar para o ranking»
  // (utilizador real, 18 out: dizia que contava mesmo quando não contava).
  const text = t(match.ranked_intent === false ? 'friends.share_text_friendly' : 'friends.share_text', {
    name: creatorName || '', day: dayText(match.scheduled_date, i18n.language), link: sessionLink(match.id),
  })
  return (
    <div>
      <button type="button" onClick={() => shareWithMissing(text)}
        className="press flex min-h-[48px] w-full items-center justify-center gap-2 rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900">
        <Share2 size={16} /> {t('friends.share_missing')}
      </button>
      <p className="mt-1.5 text-center text-xs text-muted">{t('friends.share_missing_hint')}</p>
    </div>
  )
}
