// Os quadrados de dados da página de um evento (R3 do redesign): grelha de 2,
// fundo cinzento-claro, a etiqueta em mono por cima e o valor em negrito.
// `value` é um nó, para caber a pastilha do nível. A morada fica à parte
// (o «Abrir com…» de cada página).
export default function EventFacts({ items = [], className = '' }) {
  const shown = items.filter((it) => it && it.value != null && it.value !== '')
  if (!shown.length) return null
  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      {shown.map((it) => (
        <div key={it.key || it.label} className="min-w-0 rounded-[14px] bg-[#F4F4F0] px-3.5 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-ink-500">{it.label}</p>
          <div className="mt-1 text-[15px] font-extrabold leading-snug text-ink-900 break-words">{it.value}</div>
        </div>
      ))}
    </div>
  )
}
