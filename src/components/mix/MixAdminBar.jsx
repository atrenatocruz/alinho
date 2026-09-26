// A barra de quem organiza, na página do mix (ações do evento, assunto 1,
// aprovado a 26 set). A mesma forma da do torneio: em cima onde se está,
// uma linha com o que falta, UM botão preto para o passo seguinte, e ao
// lado «Editar» e «Mais ⋯». Tudo o resto (recomeçar, cancelar, mudar só
// este dia) vive na folha do «Mais», cada ação com a sua frase.
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Pencil } from 'lucide-react'
import { MonoLabel } from '../tournament/TournamentBits'

export default function MixAdminBar({ stateLabel, line, error, primary, onEdit, onMore }) {
  const { t } = useTranslation()
  // Compactos, para os três caberem numa linha no telemóvel (como no desenho).
  const secondary = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-ctrl border border-line bg-surface px-2.5 text-sm font-extrabold text-ink-900 shrink-0 whitespace-nowrap'
  const primaryClass = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-ctrl bg-ink-900 px-2.5 text-sm leading-tight font-extrabold text-white disabled:opacity-50'
  const long = (primary?.label || '').length > 16
  return (
    <div className="card">
      <MonoLabel>{t('eventactions.bar_label', { state: stateLabel })}</MonoLabel>
      {line && <p className="mt-1.5 text-xs text-ink-700">{line}</p>}
      {/* Um nome comprido («Terminar e dar os pontos») não cabe ao lado dos
          outros dois: vai sozinho numa linha por cima, inteiro. */}
      {primary && long && (
        <button type="button" onClick={primary.onClick} disabled={primary.disabled}
          className={`${primaryClass} mt-2.5 w-full`}>
          {primary.label}
        </button>
      )}
      <div className={`${long ? 'mt-1.5' : 'mt-2.5'} flex gap-1.5`}>
        {primary && !long && (
          <button type="button" onClick={primary.onClick} disabled={primary.disabled}
            className={`${primaryClass} min-w-0 flex-1 whitespace-nowrap`}>
            {primary.label}
          </button>
        )}
        {onEdit && (
          <button type="button" onClick={onEdit} className={`${secondary} ${long ? 'flex-1' : ''}`}>
            <Pencil size={14} /> {t('eventactions.edit')}
          </button>
        )}
        <button type="button" onClick={onMore} className={`${secondary} ${long ? 'flex-1' : ''}`} aria-haspopup="dialog">
          {t('eventactions.more')} <MoreHorizontal size={16} />
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm font-extrabold text-danger">{error}</p>}
    </div>
  )
}
