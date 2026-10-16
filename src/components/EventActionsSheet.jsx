// A folha do «Mais ⋯» (ações do evento, desenho aprovado a 26 set,
// design-handoff/2026-09-26-acoes-do-evento). Peça comum a todos os
// eventos; por agora só o mix a usa (PO, 26 set — os outros ligam-se depois
// do Smash Cup, onde o desenho o pedir).
//
// Regras do desenho: em cima o nome e a data do evento; cada ação com a
// frase do que acontece por baixo; só aparecem as que fazem sentido; a que
// estraga (vermelho) vai em último e pergunta antes — quem pergunta é quem
// chama, com a ConfirmSheet.
// R3b (13 out, SPEC 2026-10-13-acoes-de-quem-organiza): o título a 19 px/900,
// por baixo, em mono, «ORGANIZAÇÃO · <ESTADO>» (`eyebrow`); cada linha com o
// nome (15 px/700), a frase (12,5 px cinzento) e «›»; a vermelha em último,
// sem «›».
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function EventActionsSheet({ open, title, subtitle, eyebrow = null, actions = [], onClose }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const ordered = [...actions.filter((a) => !a.danger), ...actions.filter((a) => a.danger)]

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-actions-title"
        className="w-full max-w-md rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-lift sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-ink-200" />
        <p id="event-actions-title" className="font-display text-[19px] font-black leading-tight text-ink-900">{title}</p>
        {eyebrow && <p className="mt-1 font-mono text-[10.5px] font-medium uppercase tracking-[.08em] text-[#4F535A]">{eyebrow}</p>}
        {subtitle && <p className="mt-1 text-[13px] text-ink-500">{subtitle}</p>}
        <div className="mt-3 divide-y divide-line border-t border-line">
          {ordered.map((a) => (
            <button
              key={a.key}
              type="button"
              // `disabled`: a ação existe mas agora não se pode — fica à vista,
              // apagada, com a razão por baixo (torneio, 28 set).
              disabled={a.disabled}
              onClick={() => { onClose(); a.onClick() }}
              className="flex w-full items-center gap-3 py-3.5 text-left disabled:cursor-default"
            >
              <span className="min-w-0 flex-1">
                <span className={`block font-display text-[15px] font-bold ${a.disabled ? 'text-ink-500' : a.danger ? 'text-danger' : 'text-ink-900'}`}>{a.label}</span>
                {a.hint && <span className="mt-0.5 block text-[12.5px] leading-snug text-[#5B6068]">{a.hint}</span>}
              </span>
              {!a.danger && <span aria-hidden="true" className="shrink-0 text-[18px] text-[#8A8E95]">›</span>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
