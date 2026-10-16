import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { User, Star, StarOff, Crown, UserX } from 'lucide-react'
import { Avatar, RatingBadge } from '../ui'

/* Gerir › Pessoas, proposta A (Renato, 16 out): tudo o que se faz a um
   membro numa folha — ver o perfil, dar ou tirar admin, passar a dono,
   remover. Remover continua a pedir confirmação (handleDeleteUser). O
   próprio admin não se remove daqui. */

export default function MemberSheet({ member, isSelf, canTransfer, onClose, onToggleAdmin, onTransfer, onRemove }) {
  const { t } = useTranslation()
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const row = 'flex min-h-[52px] w-full items-center gap-3 border-t border-line px-1 text-left text-[15px] font-extrabold'
  const ic = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-ctrl'

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="member-sheet-name" onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-card bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-lift animate-pop sm:max-w-md sm:rounded-card">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
        <div className="flex items-center gap-3 pb-3">
          <Avatar name={member.name} url={member.avatar_url} size="w-12 h-12 text-base" />
          <div className="min-w-0 flex-1">
            <p id="member-sheet-name" className="truncate font-display text-lg font-extrabold text-ink-900">{member.name}</p>
            <p className="flex items-center gap-2 text-xs text-muted">
              {member.is_admin ? t('people.role_admin') : t('people.role_member')}
              <RatingBadge rating={member.rating} gender={member.gender} />
            </p>
          </div>
        </div>

        <Link to={`/jogador/${member.id}`} onClick={onClose} className={`${row} text-ink-900`}>
          <span className={`${ic} bg-surface`}><User size={17} /></span>{t('people.view_profile')}
        </Link>
        <button type="button" onClick={onToggleAdmin} className={`${row} text-ink-900`}>
          <span className={`${ic} bg-surface`}>{member.is_admin ? <StarOff size={17} /> : <Star size={17} />}</span>
          {member.is_admin ? t('gerirclube.revoke_admin_button') : t('gerirclube.grant_admin_button')}
        </button>
        {canTransfer && (
          <button type="button" onClick={onTransfer} className={`${row} text-ink-900`}>
            <span className={`${ic} bg-surface`}><Crown size={17} /></span>{t('gerirclube.transfer_owner_button')}
          </button>
        )}
        {!isSelf && (
          <button type="button" onClick={onRemove} className={`${row} text-danger`}>
            <span className={`${ic} bg-danger/10`}><UserX size={17} /></span>{t('people.remove')}
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
