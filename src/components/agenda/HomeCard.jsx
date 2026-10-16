/* R1 — Cartões da Home (design-handoff/2026-10-13-redesign/R1-cartoes-da-home.md,
   aprovado pelo Francisco a 13 out; medidas do protótipo 2026-10-13-cartoes-
   cor-forte). A moldura comum dos cartões de evento: a faixa sólida na cor
   forte do tipo (R0) com o tipo, a pastilha de estado, a hora grande e as
   vagas; ou, com foto, a foto e uma faixa fina. Por baixo, o corpo branco,
   sem contorno, com o clube, o nome, a linha cinzenta, o estado e as caras
   com um botão. «Os teus» levam 2 px a lima à volta. Sem bonecos.

   Só o aspeto: os dados e as ações vêm de cada cartão (EventCard, …). */
import { Link } from 'react-router-dom'
import FaceCircles from '../event/FaceCircles'
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
          <div className="pointer-events-none relative h-[120px] bg-cover bg-center" style={{ backgroundImage: `url("${String(imageUrl).replace(/"/g, "%22")}")`, backgroundColor: band }}>
            <span className="absolute left-3 top-3 rounded-md px-2 py-[5px] font-mono text-[10.5px] font-medium uppercase leading-none tracking-[.1em] text-white"
              style={{ background: band }}>{label}</span>
            {/* Por cima da foto, a pastilha escura ganha fundo para se ler; a
                lima «✓ Estás dentro» já se lê e o fundo ficava como uma sombra
                (Francisco, 16 out). */}
            {pill && (
              <span className={`absolute right-3 top-3 rounded-full ${pill.type === BandPill && (pill.props.tone ?? 'me') === 'me' ? '' : 'bg-black/55'}`}>{pill}</span>
            )}
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

/** As caras e os lugares que faltam (FaceCircles: no máximo 6 círculos, com
 *  «+N» — R1, decisão do Francisco a 14 out) e, à direita, o botão. `free`:
 *  os lugares que faltam (duplas, no torneio); sem ele, `slots - pessoas`. */
export function CardFoot({ people = [], slots = 0, free = null, children }) {
  const missing = free ?? Math.max(0, slots - people.length)
  return (
    <div className="mt-3 flex items-center gap-2.5">
      {/* pointer-events-none: tocar nas caras abre o cartão, como o resto (Francisco, 16 out). */}
      <FaceCircles people={people} free={missing} size="sm" className="pointer-events-none" />
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
