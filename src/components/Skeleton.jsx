// Esqueletos: uma regra para a app toda (SPEC 2026-10-12-esqueletos-app,
// aprovada pelo Francisco a 12 out: «Sim aprovo os esqueletos»). Acaba o
// círculo a rodar: a página abre logo com a forma dela; o que não depende dos
// dados é a sério desde o início, e só o que vem dos dados fica a cinzento.
//
// A peça comum (uma só, usada em todas as páginas):
//   <SkLine size="title|text|label|big" w="60%" />  — linha de texto (22/12/9/28 px)
//   <SkCircle size={40} />                           — fotos, logótipos
//   <SkPill w={56} h={22} />                         — nível, «Inscrito», «Clube»
//   <SkBlock h={52} />                               — botões de estado, capas, caixas
//   <SkCard>…</SkCard>                               — cartão neutro (#F4F4F0 / #EEEEE9)
// O cinzento é #ECECE7, com os cantos dos elementos verdadeiros e um brilho
// lento (1,6 s, só opacity/transform; sem ele com «reduzir movimento»).
//
// E as regras de tempo:
//   useSkeleton(loading) → true só se a página demorar mais de 0,2 s (mais
//     rápida, o cinzento nem chega a aparecer);
//   useLoadTimeout(loading) → true ao fim de 8 s sem dados (o erro de sempre);
//   <FillIn> — os dados entram no mesmo sítio com um fade de 0,35 s;
//   <SkeletonGate> — para as páginas que fazem «if (loading) return …»: trata
//     sozinha dos 0,2 s e dos 8 s, sem hooks novos na página.
// Nada aqui tem texto nem números: o cinzento não inventa conteúdo.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, PrimaryButton } from './ui'

const LINE_H = { title: 22, text: 12, label: 9, big: 28 }

const base = 'sk relative overflow-hidden bg-[#ECECE7]'

export function SkLine({ size = 'text', w = '70%', className = '' }) {
  const h = LINE_H[size] || LINE_H.text
  return <span aria-hidden className={`${base} block rounded-[6px] ${className}`} style={{ height: h, width: w }} />
}

export function SkCircle({ size = 40, className = '' }) {
  return <span aria-hidden className={`${base} block shrink-0 rounded-full ${className}`} style={{ width: size, height: size }} />
}

export function SkPill({ w = 56, h = 22, className = '' }) {
  return <span aria-hidden className={`${base} block shrink-0 rounded-full ${className}`} style={{ width: w, height: h }} />
}

export function SkBlock({ h = 52, w = '100%', rounded = 'rounded-ctrl', className = '' }) {
  return <span aria-hidden className={`${base} block ${rounded} ${className}`} style={{ height: h, width: w }} />
}

export function SkCard({ children, className = '' }) {
  return <div aria-hidden className={`rounded-card border border-[#EEEEE9] bg-[#F4F4F0] p-3.5 ${className}`}>{children}</div>
}

/** O conteúdo verdadeiro a entrar no sítio do cinzento (fade 0,35 s). */
export function FillIn({ children, className = '' }) {
  return <div className={`animate-fill-in ${className}`}>{children}</div>
}

/** true só quando `loading` já dura mais de 0,2 s. */
export function useSkeleton(loading, delay = 200) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!loading) { setShow(false); return undefined }
    const tm = setTimeout(() => setShow(true), delay)
    return () => clearTimeout(tm)
  }, [loading, delay])
  return loading && show
}

/** true quando `loading` já dura 8 s: mostra-se o erro de sempre. */
export function useLoadTimeout(loading, ms = 8000) {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!loading) { setLate(false); return undefined }
    const tm = setTimeout(() => setLate(true), ms)
    return () => clearTimeout(tm)
  }, [loading, ms])
  return loading && late
}

/** Para leitores de ecrã: o esqueleto inteiro é um só «A carregar…». */
export function SkeletonPage({ label, children, className = '' }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  )
}

/** O erro de sempre, ao fim de 8 s sem dados («Tentar novamente»). */
export function LoadError({ onRetry }) {
  const { t } = useTranslation()
  return (
    <EmptyState title={t('app.load_error_title')} subtitle={t('app.load_error_body')}
      action={<PrimaryButton onClick={onRetry || (() => window.location.reload())}>{t('app.load_error_retry')}</PrimaryButton>} />
  )
}

/** Para pôr no lugar de um «if (loading) return <círculo>»: a moldura
 *  (`frame`, a sério) logo; o esqueleto (`children`) só depois de 0,2 s; e,
 *  aos 8 s, o erro de sempre. Vive enquanto a página está a carregar. */
export function SkeletonGate({ frame = null, children, onRetry }) {
  const { t } = useTranslation()
  const show = useSkeleton(true)
  const late = useLoadTimeout(true)
  return (
    <div>
      {frame}
      {late ? <div className="mt-3"><LoadError onRetry={onRetry} /></div>
        : show ? <SkeletonPage label={t('common.loading')}>{children}</SkeletonPage> : null}
    </div>
  )
}

/** Uma linha de lista a cinzento: foto, 2 linhas e uma pastilha à direita. */
export function SkRow() {
  return (
    <SkCard className="flex items-center gap-3">
      <SkCircle size={40} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <SkLine size="text" w="58%" />
        <SkLine size="label" w="36%" />
      </div>
      <SkPill w={48} h={22} />
    </SkCard>
  )
}

/** Um cartão branco a sério (cantos de 20 px, sombra) com linhas cinzentas
 *  dentro: para as listas de cartões brancos no fundo da página (UX, 18 out:
 *  cinzento sobre o fundo cinzento quase não se via). */
export function SkWhiteCard({ lines = 3, className = '' }) {
  const ws = ['38%', '70%', '52%']
  return (
    <div aria-hidden className={`rounded-[20px] bg-white p-4 shadow-card space-y-2.5 ${className}`}>
      <SkLine size="label" w={ws[0]} />
      <SkLine size="title" w={ws[1]} />
      {lines > 2 && <SkLine size="text" w={ws[2]} />}
    </div>
  )
}

/** Página genérica (enquanto chega o código de uma página carregada à
 *  parte): o título e 3 cartões, a cinzento. */
export function GenericPageSkeleton() {
  return (
    <div className="space-y-3 pt-4">
      <SkLine size="title" w="48%" />
      <SkRow />
      <SkRow />
      <SkRow />
    </div>
  )
}
