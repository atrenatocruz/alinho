// A folha do «Mais ⋯» (ações do evento, desenho aprovado a 26 set,
// design-handoff/2026-09-26-acoes-do-evento). Peça comum a todos os
// eventos; por agora só o mix a usa (PO, 26 set — os outros ligam-se depois
// do Smash Cup, onde o desenho o pedir).
//
// Regras do desenho: em cima o nome e a data do evento; cada ação com a
// frase do que acontece por baixo; só aparecem as que fazem sentido; a que
// estraga (vermelho) vai em último e pergunta antes — quem pergunta é quem
// chama, com a ConfirmSheet.
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function EventActionsSheet({ open, title, subtitle, actions = [], onClose }) {
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
        <p id="event-actions-title" className="text-[20px] font-extrabold leading-tight text-ink-900">{title}</p>
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
              className="block w-full py-3.5 text-left disabled:cursor-default"
            >
              <span className={`block text-[15px] font-extrabold ${a.disabled ? 'text-ink-500' : a.danger ? 'text-danger' : 'text-ink-900'}`}>{a.label}</span>
              {a.hint && <span className="mt-0.5 block text-[13px] leading-snug text-ink-500">{a.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
