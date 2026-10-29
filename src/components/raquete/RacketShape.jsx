/* Os três formatos de raquete, desenhados (Renato, 27 out: «vetores a mostrar
   cada um dos formatos»). Contorno da cabeça + cabo, a traço, com a cor do
   texto à volta (`currentColor`). Os furos são só para se ler «raquete». */

const HEADS = {
  // Redonda: cabeça quase circular, o ponto doce ao centro.
  redonda: 'M20 3 C31 3 37 11 37 21 C37 31 30 39 20 39 C10 39 3 31 3 21 C3 11 9 3 20 3 Z',
  // Lágrima: mais larga em cima, afunila para o cabo.
  lagrima: 'M20 2 C32 2 37 10 36 19 C35 28 28 35 20 40 C12 35 5 28 4 19 C3 10 8 2 20 2 Z',
  // Diamante: topo achatado e lados retos até ao cabo.
  diamante: 'M12 2 L28 2 C33 2 37 6 37 11 L35 22 L20 40 L5 22 L3 11 C3 6 7 2 12 2 Z',
}

const HOLES = [[14, 13], [20, 11], [26, 13], [12, 20], [20, 19], [28, 20], [16, 27], [24, 27]]

export default function RacketShape({ shape, className = 'h-12 w-8' }) {
  const head = HEADS[shape]
  if (!head) return null
  return (
    <svg viewBox="0 0 40 64" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true">
      <path d={head} />
      {HOLES.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.1" fill="currentColor" stroke="none" />)}
      {/* O cabo */}
      <path d="M17 40 L17 61 Q20 63 23 61 L23 40" />
    </svg>
  )
}
