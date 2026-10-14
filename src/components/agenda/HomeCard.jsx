/* R1 — Cartões da Home (design-handoff/2026-10-13-redesign/R1-cartoes-da-home.md,
   aprovado pelo Francisco a 13 out; medidas do protótipo 2026-10-13-cartoes-
   cor-forte). A moldura comum dos cartões de evento: a faixa sólida na cor
   forte do tipo (R0) com o tipo, a pastilha de estado, a hora grande e as
   vagas; ou, com foto, a foto e uma faixa fina. Por baixo, o corpo branco,
   sem contorno, com o clube, o nome, a linha cinzenta, o estado e as caras
   com um botão. «Os teus» levam 2 px a lima à volta. Sem bonecos.

   Só o aspeto: os dados e as ações vêm de cada cartão (EventCard, …). */
import { Link } from 'react-router-dom'
import { Avatar } from '../ui'
import { KIND_COLORS } from '../../lib/kindColors'

/** As cores de um tipo: { strong, dark, light, line } (R0, kindColors). */
const FALLBACK = { strong: '#374151', dark: '#1F2937', light: '#EEF0F3', line: '#D1D5DB' }
export const kindColorsOf = (kind) => KIND_COLORS[kind] || FALLBACK

export default function HomeCard({ colors = FALLBACK, label, pill = null, time, timeAside = null, count = null,
  imageUrl = null, mine = false, past = false, to = null, ariaLabel, children }) {
  const c = colors || FALLBACK
  // Já passou: a faixa a cinzento, como o resto do que passou.
  const band = past ? '#8A8E95' : c.strong
  const cnt = count && (
    <span className="text-right text-[11.5px] font-medium leading-[1.15] opacity-95">
      <b className="block font-display text-[22px] font-extrabold leading-none tabular-nums">
        {count.n}<small className="text-[13px] opacity-75">/{count.of}</small>
      </b>
      {count.unit}
    </span>
  )
  const hourRow = (
    <div className="flex items-end justify-between gap-2">
      <span className="font-display text-[32px] font-extrabold leading-none tracking-[-.035em] tabular-nums">
        {time}
        {timeAside && <small className="ml-2 font-display text-[13px] font-medium tracking-normal opacity-85">{timeAside}</small>}
      </span>
      {cnt}
    </div>
  )
  return (
    <div className={`relative overflow-hidden rounded-[20px] bg-white press ${mine && !past
      ? 'shadow-[0_0_0_2px_#C8DC00,0_10px_24px_-16px_rgba(17,17,17,.3)]'
      : 'shadow-[0_1px_2px_rgba(17,17,17,.06),0_10px_24px_-16px_rgba(17,17,17,.3)]'}`}>
      {to && <Link to={to} className="absolute inset-0" aria-label={ariaLabel} />}
      {imageUrl ? (
        <>
          <div className="relative h-[120px] bg-cover bg-center" style={{ backgroundImage: `url("${String(imageUrl).replace(/"/g, "%22")}")`, backgroundColor: band }}>
            <span className="absolute left-3 top-3 rounded-md px-2 py-[5px] font-mono text-[10.5px] font-medium uppercase leading-none tracking-[.1em] text-white"
              style={{ background: band }}>{label}</span>
            {/* Por cima da foto, a pastilha escura ganha fundo para se ler (QA, 13 out). */}
            {pill && <span className="absolute right-3 top-3 rounded-full bg-black/55">{pill}</span>}
          </div>
          <div className="px-3.5 py-[9px] text-white" style={{ background: band }}>{hourRow}</div>
        </>
      ) : (
        <div className="px-3.5 pb-3 pt-[11px] text-white" style={{ background: band }}>
          <div className="flex items-center justify-between gap-2 font-mono text-[10.5px] font-medium uppercase leading-[1.2] tracking-[.1em]">
            <span className="min-w-0 truncate">{label}</span>
            {pill}
          </div>
          <div className="mt-1.5">{hourRow}</div>
        </div>
      )}
      <div className="px-3.5 pb-3.5 pt-3">{children}</div>
    </div>
  )
}

/** A pastilha da faixa: «✓ Estás dentro» (lima) ou escura («Convidado»). */
export function BandPill({ tone = 'me', children }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-[9px] py-1 font-display text-[11px] font-bold normal-case leading-none tracking-normal ${
      tone === 'me' ? 'bg-lime-400 text-ink-900' : 'bg-white/20 text-white'}`}>{children}</span>
  )
}

/** O nome do evento. */
export function CardTitle({ children, past = false }) {
  return <h3 className={`mt-1.5 font-display text-[17.5px] font-extrabold leading-[1.2] tracking-[-.01em] ${past ? 'text-muted' : 'text-ink-900'}`}>{children}</h3>
}

/** A linha cinzenta: formato, campos, preço. */
export function CardChips({ children }) {
  return <p className="mt-1 text-[13px] leading-[1.45] text-[#4F535A]">{children}</p>
}

/** A linha de estado com o ponto: warn (laranja-escuro), ok (verde-escuro),
 *  inv (preto, ponto lima). */
export function CardState({ tone = 'ok', children }) {
  const color = tone === 'warn' ? '#B13A10' : tone === 'inv' ? '#111111' : '#3F6212'
  return (
    <p className="mt-2 flex items-center gap-1.5 font-display text-[13px] font-bold leading-[1.25]" style={{ color }}>
      <i className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: tone === 'inv' ? '#C8DC00' : color }} />
      {children}
    </p>
  )
}

/** As caras (até 4, depois «+N») e, à direita, o botão. Lugares livres a
 *  tracejado só nos jogos de até 4 lugares (jogo em aberto, amigos): um por
 *  lugar, e caras e tracejados somam o total (1/4 = 1 cara e 3 tracejados).
 *  Nos mixes e torneios, sem tracejados (Francisco via PO e UX, 14 out). */
export function CardFoot({ people = [], slots = 0, children }) {
  const shown = people.slice(0, 4)
  const more = people.length - shown.length
  const empty = slots > 0 && slots <= 4 ? Math.max(0, slots - people.length) : 0
  return (
    <div className="mt-3 flex items-center gap-2.5">
      {/* isolate: a ordem das caras (zIndex 10 - i) fica só dentro da fila —
          a primeira cara (z 10) aparecia por cima do topo preso da Home (z-10)
          ao descer (Francisco, 13 out). */}
      <div className="isolate flex items-center">
        {shown.map((p, i) => (
          <span key={p.id || i} className="relative -mr-2 flex rounded-full border-2 border-white" style={{ zIndex: 10 - i }}>
            <Avatar name={p.name} url={p.avatar_url} size="w-7 h-7 text-[10px]" />
          </span>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          // Sobrepõem-se como as caras, com o anel branco: cada um tapa o
          // anterior e não parece partido (UX, 14 out).
          <span key={`e${i}`} aria-hidden="true" style={{ zIndex: 10 - shown.length - i, boxShadow: '0 0 0 2px #fff' }}
            className="relative -mr-2 h-[28px] w-[28px] rounded-full border-2 border-dashed border-[#C9CCD1] bg-white" />
        ))}
        {more > 0 && (
          <span className="-mr-2 grid h-[32px] w-[32px] place-items-center rounded-full border-2 border-white bg-[#F1F2EE] font-display text-[10.5px] font-bold text-[#4F535A]">+{more}</span>
        )}
      </div>
      {children && <div className="relative ml-auto flex flex-col items-stretch gap-1">{children}</div>}
    </div>
  )
}

/** O botão do cartão: lima (a ação) ou contorno («Ver»). Não abre o evento. */
export function CardButton({ variant = 'lime', onClick, disabled = false, children }) {
  return (
    <button type="button" disabled={disabled}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick?.() }}
      className={`press relative whitespace-nowrap rounded-[14px] px-[18px] py-[11px] text-center font-display text-[14.5px] font-extrabold leading-none text-ink-900 disabled:opacity-50 ${
        variant === 'lime' ? 'bg-lime-400' : 'border-[1.5px] border-[#CFD2D7] bg-white'}`}>
      {children}
    </button>
  )
}
