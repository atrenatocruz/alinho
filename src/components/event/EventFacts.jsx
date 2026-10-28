// Os quadrados de dados da página de um evento (R3 do redesign): grelha de 2,
// fundo cinzento-claro, a etiqueta em mono por cima e o valor em negrito.
// `value` é um nó, para caber a pastilha do nível. A morada fica à parte
// (o «Abrir com…» de cada página). `aside` vai no canto de cima, à direita da
// etiqueta; com `onClick`, tocar no quadrado inteiro faz a ação (o «?» da
// Pontuação do torneio, Francisco 28 out, «fica o b»).
export default function EventFacts({ items = [], className = '' }) {
  const shown = items.filter((it) => it && it.value != null && it.value !== '')
  if (!shown.length) return null
  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      {shown.map((it) => {
        const Box = it.onClick ? 'button' : 'div'
        return (
          <Box key={it.key || it.label} {...(it.onClick ? { type: 'button', onClick: it.onClick, 'aria-haspopup': 'dialog' } : {})}
            className="min-w-0 rounded-[14px] bg-[#F4F4F0] px-3.5 py-3 text-left">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-ink-500">{it.label}</p>
              {it.aside && <span className="-my-1 shrink-0 text-ink-500">{it.aside}</span>}
            </div>
            <div className="mt-1 text-[15px] font-extrabold leading-snug text-ink-900 break-words">{it.value}</div>
          </Box>
        )
      })}
    </div>
  )
}
