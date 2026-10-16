/* O boneco 3D do tipo no canto dos cartões (design-handoff/2026-10-12-
   cartoes-mais-bonitos, «O avatar» — aprovado pelo Francisco a 12 out para
   testar). Um só sítio para a Home, o «Já jogados» e a página do clube, para
   não ficarem diferentes.

   - O boneco espreita por cima do cartão, no canto de cima à direita (~92 px,
     ~22 px para fora). O cartão tem de ser `relative` e não cortar
     (sem overflow-hidden) e ganha 20 px por cima (MASCOT_CARD).
   - A pastilha do canto desce para por baixo do boneco (MascotPill).
   - Um mix com imagem própria não leva boneco (a imagem manda, SPEC-3).
   - É enfeite: não se toca nele e não se lê (alt vazio). Carrega só quando
     aparece; são 4 ficheiros para a app toda. */

const FILE_BY_KIND = { mix: 'mix', open: 'aberto', tournament: 'torneio', friends: 'amigos' }

// DESLIGADO (Francisco, 12 out à noite): «Sim tira, para não lançarmos isso
// para a main na sexta… talvez em background… preciso de trabalhar com o
// designer.» Os cartões voltam a ser como antes do aa05533e; o componente e
// os webp ficam, sem uso, para a versão com o boneco em fundo.
export const MASCOTS_ON = false

/** O boneco de um cartão, ou null (desligado, tipo sem boneco, ou mix com imagem). */
export const mascotFor = (kind, imageUrl = null) => (!MASCOTS_ON || imageUrl ? null : FILE_BY_KIND[kind] || null)

/** As classes do cartão com boneco: não corta o que sai e abre espaço por cima
 *  (!mt: o space-y das listas ganharia a um mt normal). Sem boneco, o corte
 *  de sempre. */
export const mascotCardClass = (mascot) => (mascot ? '!mt-5' : 'overflow-hidden')

/** small: os cartões baixos da página do clube — 64 px, 14 px por cima (UX, 12 out). */
export default function CardMascot({ type, small = false }) {
  if (!type) return null
  return (
    <img
      src={`/bonecos/${type}-192.webp`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      className={`pointer-events-none absolute -right-1.5 z-[2] h-auto [filter:drop-shadow(0_6px_10px_rgba(0,0,0,0.18))] ${small ? '-top-[14px] w-[64px]' : '-top-[22px] w-[92px]'}`}
    />
  )
}

/** A pastilha do canto, por baixo do boneco, encostada à direita. `top`: à
 *  altura da hora (com quem organiza em cima) ou do título (sem); `right`:
 *  o padding do cartão. */
export function MascotPill({ top = 'top-[74px]', right = 'right-3.5', children }) {
  if (!children) return null
  return <span className={`absolute ${right} ${top} z-[2] flex max-w-[42%] justify-end`}>{children}</span>
}
