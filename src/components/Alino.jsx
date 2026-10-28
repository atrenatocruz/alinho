// O Alino, a mascote da alinho.pt (design-handoff/2026-10-12-mascote,
// aprovado pelo Francisco a 12 out). Só as 5 poses aprovadas e só nos
// momentos da SPEC: festa nas folhas de confirmação, olá nas boas-vindas,
// a pensar nas páginas vazias, triste («ups») nos erros. Nunca em listas,
// em cartões de eventos, nem em assuntos sérios (privacidade, pagamentos).
//
// As imagens são webp leves em public/alino/ (fora do que a app guarda ao
// instalar) e carregam só quando aparecem. O alt é vazio: o texto ao lado
// já diz tudo.

// Largura de cada pose a 320 px de altura, para o espaço ficar reservado
// antes de a imagem chegar (sem saltos).
// Poses novas de 21 out (biblioteca-pronta): o mesmo boneco com o recorte
// limpo, um pouco mais largas; o @2x para ecrãs de alta densidade.
const WIDTH_AT_320 = { ola: 290, festa: 269, 'a-pensar': 228, triste: 224, pronto: 333, trofeu: 164 }

/** pose: 'ola' | 'festa' | 'a-pensar' | 'triste' | 'pronto' | 'trofeu'.
 *  size: a altura em px (cerca de 150 nas páginas da app). */
export default function Alino({ pose = 'ola', size = 150, className = '' }) {
  const w = WIDTH_AT_320[pose]
  if (!w) return null
  return (
    <img src={`/alino/alino-${pose}.webp`} srcSet={`/alino/alino-${pose}@2x.webp 2x`} alt="" aria-hidden="true" loading="lazy" decoding="async" draggable={false}
      width={Math.round((w * size) / 320)} height={size}
      className={`mx-auto block select-none ${className}`} />
  )
}
