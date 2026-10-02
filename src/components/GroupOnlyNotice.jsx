// Link de um jogo (ou torneio) de um grupo onde a pessoa não está (SPEC
// design-handoff/2026-10-01-jogo-de-grupo-fechado, aprovada pelo Francisco a
// 2 out). Diz de que grupo é — num grupo privado, nem isso — e nada do jogo.
// `hint` vem do getGameOrgHint (lib/gameOrgHint.js): { visible, name, slug,
// kind, logoUrl }. `keyPrefix` deixa o torneio (Dev 1) ter as suas frases
// («Este torneio é do…»), com as mesmas chaves: _title, _text, _text_club,
// _see_group, _see_club, _private_title, _private_title_club, _private_text,
// _back.
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { Avatar, PrimaryButton, orgAvatarShape } from './ui'

export default function GroupOnlyNotice({ hint, keyPrefix = 'gamedetails.closed' }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isClub = hint.kind !== 'group'
  const k = (suffix) => `${keyPrefix}_${suffix}`
  // Quem veio de um link não tem página anterior: vai para a Home.
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/'))
  return (
    // Sem sombra (regra de 28 set; UX, 2 out).
    <div className="card !shadow-none text-center py-12 px-6 animate-fade-up">
      <div className="mx-auto mb-5 flex justify-center">
        {hint.visible
          ? <Avatar name={hint.name} url={hint.logoUrl} size="w-20 h-20 text-2xl" shape={orgAvatarShape(hint.kind)} />
          : <div className="w-20 h-20 rounded-full bg-ink-50 flex items-center justify-center"><Lock size={30} className="text-ink-700" /></div>}
      </div>
      <h3 className="text-lg text-ink-900 mb-1">
        {hint.visible ? t(k('title'), { name: hint.name }) : t(k(isClub ? 'private_title_club' : 'private_title'))}
      </h3>
      <p className="text-muted text-sm mb-6">
        {hint.visible ? t(k(isClub ? 'text_club' : 'text')) : t(k('private_text'))}
      </p>
      <div className="space-y-2.5">
        {hint.visible && (
          <PrimaryButton variant="navy" className="w-full !bg-ink-900" onClick={() => navigate(`/clube/${hint.slug}`)}>
            {t(k(isClub ? 'see_club' : 'see_group'))}
          </PrimaryButton>
        )}
        <PrimaryButton variant="ghost" className="w-full" onClick={goBack}>{t(k('back'))}</PrimaryButton>
      </div>
    </div>
  )
}
