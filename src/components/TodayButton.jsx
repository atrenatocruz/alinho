import { useTranslation } from 'react-i18next'

/**
 * Voltar a hoje num toque, como no Google Calendar: um calendário com o
 * número do dia de hoje (design-handoff/2026-09-27-home-botao-hoje, aprovado
 * pelo Francisco). Peça partilhada — a Home usa-a ao lado da data, e o
 * calendário do professor (Dev 4) para voltar à semana de hoje.
 * 44 px de área de toque; o desenho do ícone tem 26 px.
 */
export default function TodayButton({ onClick, label, className = '' }) {
  const { t } = useTranslation()
  const day = new Date().getDate()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label || t('agenda.back_to_today')}
      title={label || t('agenda.back_to_today')}
      className={`inline-flex w-11 h-11 shrink-0 items-center justify-center rounded-full text-ink-900 hover:bg-ink-50 transition-colors duration-fast ${className}`}
    >
      <span aria-hidden="true" className="relative flex w-[26px] h-[26px] items-end justify-center rounded-[7px] border-2 border-current pb-[1px]">
        {/* As argolas do calendário. */}
        <span className="absolute -top-[4px] left-[5px] w-[2px] h-[6px] rounded-full bg-current" />
        <span className="absolute -top-[4px] right-[5px] w-[2px] h-[6px] rounded-full bg-current" />
        <span className="text-[12px] leading-none font-extrabold tabular-nums">{day}</span>
      </span>
    </button>
  )
}
