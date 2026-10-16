// R3b — Ações de quem organiza, na página do evento (design-handoff/2026-10-
// 13-acoes-de-quem-organiza/SPEC.md, aprovado pelo Francisco a 13 out, opção
// A, com o acerto B da UX). Peça comum ao mix, ao jogo em aberto, aos amigos
// (Dev 2) e ao torneio (Dev 1). Logo a seguir à data, antes da faixa:
//   - `label`: a etiqueta em mono com o ponto da cor do tipo, «ORGANIZAS ESTE
//     MIX · INSCRIÇÕES ABERTAS»;
//   - `next` { label, onClick, disabled, hint, error }: o próximo passo, em
//     botão preto, com a frase por baixo;
//   - `nextLink` { label, onClick }: quando o botão preto vive mais abaixo na
//     página, «Próximo passo: <nome> ↓» (13 px, 700, sublinhado), que desce
//     até ele. Sem nenhum dos dois (terminado, cancelado), nada;
//   - «✎ Editar e mais opções» em contorno, sempre em último: `onMore` abre a
//     folha (EventActionsSheet, com o `eyebrow` «ORGANIZAÇÃO · <ESTADO>»).
// Só aspeto e sítio: as ações e as regras são as de cada página.
import { useTranslation } from 'react-i18next'
import { Pencil } from 'lucide-react'
import { KIND_COLORS } from '../../lib/kindColors'

export default function OrganizerBox({ kind = 'mix', label, next = null, nextLink = null, onMore }) {
  const { t } = useTranslation()
  const c = KIND_COLORS[kind] || KIND_COLORS.mix
  return (
    <div className="mt-3.5 space-y-2 rounded-[16px] bg-[#F4F5F1] p-3.5">
      <p className="flex items-start gap-2 font-mono text-[10.5px] font-medium uppercase leading-[1.35] tracking-[.08em] text-[#4F535A]">
        <i aria-hidden="true" className="mt-[3px] h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: c.strong }} />
        <span className="min-w-0">{label}</span>
      </p>
      {next ? (
        <div className="space-y-1.5">
          <button type="button" onClick={next.onClick} disabled={next.disabled}
            className="press flex min-h-[48px] w-full items-center justify-center rounded-[14px] bg-ink-900 px-3.5 font-display text-[14.5px] font-extrabold leading-tight text-white disabled:opacity-50">
            {next.label}
          </button>
          {next.hint && (typeof next.hint === 'string' ? <p className="text-[12.5px] leading-snug text-[#5B6068]">{next.hint}</p> : next.hint)}
          {next.error && <p role="alert" className="text-sm font-extrabold text-danger">{next.error}</p>}
        </div>
      ) : nextLink ? (
        <button type="button" onClick={nextLink.onClick}
          className="block text-left font-display text-[13px] font-bold text-ink-900 underline underline-offset-2">
          {t('organizer.next_below', { step: nextLink.label })}
        </button>
      ) : null}
      <button type="button" onClick={onMore} aria-haspopup="dialog"
        className="press flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-[#CFD2D7] bg-white px-4 font-display text-[14.5px] font-extrabold text-ink-900">
        <Pencil size={15} /> {t('organizer.edit_and_more')}
      </button>
    </div>
  )
}
