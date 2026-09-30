// A explicação de uma regra, sempre recolhida num «?» (Francisco, 28 set:
// «mete sempre com icon para sabermos mais», design-handoff/2026-09-28-
// avisos-desempate, regra geral para toda a app): uma linha pequena com o
// ícone redondo e o assunto; ao tocar, abre a explicação por baixo (caixa
// cinzenta clara, contorno fino). Fechada por omissão.
//   <RuleHint label="Como se desempata" items={['Mais vitórias.', …]} note="Uma falta conta como 6-0 6-0." />
import { useId, useState } from 'react'
import { HelpCircle } from 'lucide-react'

export default function RuleHint({ label, title = label, items = [], note = null, className = '' }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={id}
        className="press inline-flex min-h-[32px] items-center gap-1.5 text-xs text-muted">
        <HelpCircle size={15} className="shrink-0" /> {label}
      </button>
      {open && (
        <div id={id} className="mt-1 rounded-card border border-line bg-ink-50 p-3 text-sm text-ink-700">
          <p className="font-extrabold text-ink-900">{title}</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {items.map((item) => <li key={item}>{item}</li>)}
          </ol>
          {note && <p className="mt-1.5">{note}</p>}
        </div>
      )}
    </div>
  )
}
