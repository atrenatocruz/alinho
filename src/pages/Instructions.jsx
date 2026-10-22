import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { SiteHeader, SiteFooter, usePageTop } from '../components/site/SiteChrome'
import { BotChat, SITE_EYEBROW, SITE_H2, SITE_ILL } from '../components/site/SiteWays'
import { SITE_DARK } from '../components/site/MedalShowcase'
import { SUPPORT_EMAIL, SUPPORT_EMAIL_READY, whatsappContactLink } from '../lib/contacts'
import { XP_TIERS } from '../lib/xp'
import { GLASS_BAR_H } from '../components/GlassBar'

/* A Ajuda (substitui as «Instruções») — design-handoff/2026-10-13-ajuda
   (desenho e textos aprovados pelo Francisco a 13 out) com os dois acertos
   do site arrumado (14–17 out): «Para quem organiza» passa a perguntas, e as
   quatro caixas do topo servem de índice. Uma só peça (HelpContent) para a
   página do site (sem sessão) e para a ajuda dentro da app (com sessão,
   Renato 17 out).

   As âncoras de sempre continuam: #faq, #whatsapp, #ranking e #xp (o robô e
   o «?» dos Rankings levam lá), e junta-se #organizar. */

// **assim** = o que se escreve, a negrito.
const bold = (text, cls = 'font-extrabold text-ink-900') => String(text).split('**').map((part, i) => (i % 2 ? <b key={i} className={cls}>{part}</b> : part))

const FAQ = [1, 2, 3, 4, 5, 6, 7]
const ORG = [1, 2, 3, 4, 5]

/* FAQ (SEO, 29 set): as perguntas em JSON-LD, para os resumos do Google
   terem de onde citar. Uma fonte só (ajuda.faq_qN / faq_aN). */
function useFaqJsonLd(t) {
  useEffect(() => {
    const el = document.createElement('script')
    el.type = 'application/ld+json'
    el.id = 'faq-jsonld'
    el.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map((i) => ({
        '@type': 'Question',
        name: t(`ajuda.faq_q${i}`),
        acceptedAnswer: { '@type': 'Answer', text: t(`ajuda.faq_a${i}`).replaceAll('**', '') },
      })),
    })
    document.head.appendChild(el)
    return () => el.remove()
  }, [t])
}

/** Uma pergunta que abre e fecha, como as do «Como funciona». */
function Question({ q, children, open: startOpen = false }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <div className="border-b border-[#E2E3DE]">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex min-h-[56px] w-full items-center justify-between gap-3 py-3 text-left font-display text-[17px] font-extrabold text-ink-900">
        {q}
        <ChevronDown size={20} className={`shrink-0 text-ink-900 transition-transform duration-fast ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pb-5 text-[16px] leading-[1.55] text-[#5B6068]">{children}</div>}
    </div>
  )
}

// Onde fica o índice preso: por baixo do cabeçalho do site (--site-head,
// SiteChrome) ou, na app, por baixo da barra de vidro do «‹».
const indexTop = (inApp) => (inApp ? GLASS_BAR_H : 'var(--site-head, 0px)')
// Os saltos param por baixo do índice (47 px no telemóvel, 57 no computador),
// sem tapar o título.
const indexBottom = (inApp) => `calc(${indexTop(inApp)} + 64px)`
const SECTIONS = [['faq', 'ajuda.idx_faq'], ['whatsapp', 'ajuda.nav_whatsapp'], ['ranking', 'ajuda.nav_ranking'], ['organizar', 'ajuda.nav_org']]

/** O índice numa barra só, preso em cima ao descer (ACERTO 18 out): a secção
 *  em que estás a preto com o traço lima, as outras a cinzento — a mesma
 *  letra dos separadores dos Planos (UX, 19 out: uma regra só no site). No telemóvel
 *  desliza para o lado, e a opção atual entra sempre à vista. */
function HelpIndex({ inApp, jump }) {
  const { t } = useTranslation()
  const navRef = useRef(null)
  const [cur, setCur] = useState('faq')
  useEffect(() => {
    let raf = 0
    const read = () => {
      raf = 0
      const line = (navRef.current?.getBoundingClientRect().bottom || 0) + 12
      let on = SECTIONS[0][0]
      for (const [id] of SECTIONS) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= line) on = id
      }
      setCur(on)
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read) }
    read()
    // Na app desliza o <main>, no site a janela: apanha-se os dois.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
  useEffect(() => {
    const a = navRef.current?.querySelector(`[data-id="${cur}"]`)
    const bar = navRef.current
    if (!a || !bar) return
    if (a.offsetLeft - 16 < bar.scrollLeft || a.offsetLeft + a.offsetWidth + 16 > bar.scrollLeft + bar.clientWidth) {
      bar.scrollTo({ left: a.offsetLeft - 16, behavior: 'smooth' })
    }
  }, [cur])
  return (
    // Fundo branco opaco, sem desfoque: o bloco preto do Ranking via-se por
    // baixo (UX, 19 out); igual à barra dos Planos. Os links começam na margem
    // da coluna, como o título.
    <nav aria-label={t('ajuda.nav_aria')} style={{ top: indexTop(inApp) }}
      className={`sticky z-[15] border-b border-[#E6E7E3] bg-white ${inApp ? '-mx-4' : ''}`}>
      <div ref={navRef} className={`relative mx-auto flex max-w-[760px] gap-6 overflow-x-auto [scrollbar-width:none] sm:gap-10 [&::-webkit-scrollbar]:hidden ${inApp ? 'px-4' : 'box-content px-5 lg:px-10'}`}>
        {SECTIONS.map(([id, key]) => (
          <a key={id} data-id={id} href={`#${id}`} onClick={jump(id)} aria-current={cur === id ? 'true' : undefined}
            className={`flex-none whitespace-nowrap border-b-[3px] pb-[13px] pt-[15px] font-display text-[16px] font-extrabold leading-none sm:pb-4 sm:pt-[18px] sm:text-[20px] ${
              cur === id ? 'border-lime-400 text-[#040404]' : 'border-transparent text-[#7B818C]'}`}>
            {t(key)}
          </a>
        ))}
      </div>
    </nav>
  )
}

/** Uma faixa a toda a largura (no site) ou a sair das margens da página (na
 *  app), com o conteúdo à largura de leitura. */
function Band({ id, inApp, className = '', style, children }) {
  return (
    <section id={id} style={{ scrollMarginTop: indexBottom(inApp), ...style }} className={`py-14 lg:py-20 ${inApp ? '-mx-4 px-4' : 'px-5 lg:px-10'} ${className}`}>
      <div className="mx-auto max-w-[760px]">{children}</div>
    </section>
  )
}

// Dentro da app (R12): o fundo é o cinzento da app e cada lista de perguntas
// vai num cartão branco, com o título por fora (UX, 18 out). No site, faixas
// brancas com as linhas.
const LIST = (inApp) => (inApp
  ? 'mt-5 rounded-[20px] bg-white px-4 shadow-[0_1px_2px_rgba(17,17,17,0.06)] [&>div:last-child]:border-b-0'
  : 'mt-6 border-t border-[#E2E3DE]')

const CMD_MAIN = 'rounded-[8px] bg-ink-900 px-2 py-1 font-mono text-[13px] font-bold text-lime-400'
const CMD_ALT = 'rounded-[8px] border border-[#CFD2D7] bg-white px-2 py-1 font-mono text-[13px] font-medium text-ink-900'

// Os comandos do robô: o principal a preto com letra lima, as alternativas
// em contorno (SPEC, ponto 4).
const WA = [
  { key: 'join', main: ['In'], alt: ['Dentro', 'Estou dentro'] },
  { key: 'leave', main: ['Out'], alt: ['Fora', 'Saio'] },
  { key: 'pair', main: ['In com Tiago Lopes', 'In @tiago'], alt: [] },
  { key: 'pair_leave', main: ['Out dupla', 'Out @tiago'], alt: ['Out'] },
  { key: 'full', main: ['In'], alt: [] },
  { key: 'several', main: ['In 01', '/mix'], alt: [] },
  { key: 'help', main: ['/help'], alt: [] },
]

// O quadro de exemplos do ranking (texto da BA de 6 out, à espera da
// revisão do Ruben): ganhar e perder contra o mesmo nível, 100 acima e 100
// abaixo.
const EXAMPLES = [['same', '+10', '−10'], ['above', '+13', '−7'], ['below', '+7', '−13']]
const XP = [['20 XP', 'xp_mix'], ['5 XP', 'xp_game'], ['+30 XP', 'xp_win'], ['10 XP', 'xp_friends']]

// 1.300 / 1,300: o separador dos milhares também nos números de 4 algarismos
// (o pt-PT do browser escreve «1300»).
const xpNumber = (n, lang) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : '.')

export function HelpContent({ inApp = false }) {
  const { t, i18n } = useTranslation()
  useFaqJsonLd(t)
  const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''
  // Vindo de um link com #ranking, #xp, #whatsapp…: a página desenha-se
  // depois do salto do navegador, por isso desce-se aqui.
  useEffect(() => {
    if (!hash) return undefined
    const tm = setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: 'start' }), 80)
    return () => clearTimeout(tm)
  }, [hash])
  const jump = (id) => (e) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.history.replaceState(null, '', `#${id}`)
  }
  const plansTo = inApp ? '/gerir/planos' : '/planos'

  return (
    <div>
      {/* Topo creme: o título e o Alino a dizer olá. O índice vem logo a
          seguir, numa barra presa (ACERTO 18 out). */}
      <Band inApp={inApp} className={`overflow-hidden !pt-8 lg:!pt-14 ${inApp ? '' : 'bg-[#F7F7F4]'}`}>
        <div className="relative">
          {/* O Alino da biblioteca de 21 out, inteiro. No telemóvel espreita da
              beira do ecrã: sai um pouco para fora e o topo corta-o
              (overflow-hidden). No computador fica inteiro na coluna (UX). */}
          <img src="/ajuda/alino-ola.webp" srcSet="/ajuda/alino-ola@2x.webp 2x" alt="" width="290" height="320" loading="lazy"
            className={`pointer-events-none absolute -top-2 w-[124px] select-none ${inApp ? '-right-8' : '-right-9 sm:right-0'}`} />
          <h1 className="pr-24 font-display text-[44px] font-black leading-none tracking-[-.03em] text-ink-900 sm:text-[56px]">{t('ajuda.title')}</h1>
          <p className="mt-4 max-w-[26ch] pr-20 text-[17px] leading-[1.5] text-[#2A2E35] sm:max-w-[34ch] sm:pr-28">{t('ajuda.intro')}</p>
        </div>
      </Band>
      <HelpIndex inApp={inApp} jump={jump} />

      {/* Perguntas frequentes: a primeira vem aberta. */}
      <Band id="faq" inApp={inApp} className={inApp ? '' : 'bg-white'}>
        <p className={`${SITE_EYEBROW} text-[#5B6068]`}>{t('ajuda.faq_eyebrow')}</p>
        <h2 className={`${SITE_H2} mt-3 !text-[34px]`}>{t('ajuda.faq_title')}</h2>
        <div className={LIST(inApp)}>
          {FAQ.map((i) => (
            <Question key={i} q={t(`ajuda.faq_q${i}`)} open={i === 1}>
              <p>
                {bold(t(`ajuda.faq_a${i}`))}
                {i === 3 && <> <Link to={plansTo} className="font-bold text-ink-900 underline underline-offset-2">{t('ajuda.faq_plans')}</Link></>}
              </p>
            </Question>
          ))}
        </div>
      </Band>

      {/* O robô do WhatsApp: a conversa como o robô a faz, e um cartão por
          assunto com os comandos. */}
      <Band id="whatsapp" inApp={inApp} style={{ background: '#FCE9E3' }}>
        <p className={`${SITE_EYEBROW} text-[#C2410C]`}>{t('ajuda.wa_eyebrow')}</p>
        <h2 className={`${SITE_H2} mt-3 !text-[34px]`}>{t('ajuda.wa_title')}</h2>
        <p className="mt-3 text-[17px] leading-[1.5] text-[#2A2E35]">{t('ajuda.wa_intro')}</p>
        <div className="mt-7"><BotChat help /></div>
        <p className={SITE_ILL}>{t('landing.illustrative')}</p>
        <div className="mt-6 space-y-3">
          {WA.map((w) => (
            <div key={w.key} className="rounded-[18px] bg-white px-4 py-4">
              <h3 className="font-display text-[17px] font-extrabold text-ink-900">{t(`ajuda.wa_${w.key}_t`)}</h3>
              <p className="mt-2 flex flex-wrap gap-1.5">
                {w.main.map((c) => <span key={c} className={CMD_MAIN}>{c}</span>)}
                {w.alt.map((c) => <span key={c} className={CMD_ALT}>{c}</span>)}
              </p>
              <p className="mt-2 text-[15px] leading-[1.5] text-[#5B6068]">{t(`ajuda.wa_${w.key}_b`)}</p>
            </div>
          ))}
        </div>
      </Band>

      {/* Ranking e XP: preto, como «Joga, sobe, coleciona». */}
      <Band id="ranking" inApp={inApp} className={SITE_DARK}>
        <p className={`${SITE_EYEBROW} text-lime-400`}>{t('ajuda.rk_eyebrow')}</p>
        <h2 className={`${SITE_H2} mt-3 !text-[34px] !text-white`}>{t('ajuda.rk_title')}</h2>
        <h3 className="mt-7 font-display text-[22px] font-extrabold text-white">{t('ajuda.rk_level_title')}</h3>
        <ul className="mt-3 space-y-2.5">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <li key={i} className="flex gap-3 text-[16px] leading-[1.55] text-[#C9CDD3]">
              <span aria-hidden="true" className="mt-[9px] h-2 w-2 shrink-0 rounded-full bg-lime-400" />
              <span>{bold(t(`ajuda.rk_b${i}`), 'font-extrabold text-white')}</span>
            </li>
          ))}
        </ul>
        <table className="mt-7 w-full overflow-hidden rounded-[16px] bg-[#1A1E25] text-left">
          <thead>
            <tr className="font-mono text-[11px] uppercase tracking-[.1em] text-[#AEB3BB]">
              <th className="px-4 pb-2 pt-3.5 font-medium">{t('ajuda.rk_ex_title')}</th>
              <th className="px-2 pb-2 pt-3.5 text-right font-medium">{t('ajuda.rk_ex_win')}</th>
              <th className="px-4 pb-2 pt-3.5 text-right font-medium">{t('ajuda.rk_ex_lose')}</th>
            </tr>
          </thead>
          <tbody>
            {EXAMPLES.map(([k, w, l]) => (
              <tr key={k} className="border-t border-white/10">
                <td className="px-4 py-3 font-display text-[15px] font-bold text-white">{t(`ajuda.rk_ex_${k}`)}</td>
                <td className="px-2 py-3 text-right font-display text-[16px] font-extrabold text-lime-400">{w}</td>
                <td className="px-4 py-3 text-right font-display text-[16px] font-extrabold text-[#AEB3BB]">{l}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 id="xp" style={{ scrollMarginTop: indexBottom(inApp) }} className="mt-10 font-display text-[22px] font-extrabold text-white">{t('ajuda.xp_title')}</h3>
        <p className="mt-2 text-[16px] leading-[1.55] text-[#C9CDD3]">{t('ajuda.xp_intro')}</p>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {XP.map(([v, k]) => (
            <div key={k} className="rounded-[16px] bg-[#1A1E25] px-3.5 py-3.5">
              <b className="block font-display text-[24px] font-extrabold leading-none text-lime-400">{v}</b>
              <span className="mt-1.5 block text-[14px] leading-[1.35] text-[#C9CDD3]">{t(`ajuda.${k}`)}</span>
            </div>
          ))}
        </div>
        {/* Os 10 níveis, lidos do XP_TIERS (do 1 ao 10), com o escudo de
            16 out a cores: aqui é a tabela, não o teu nível. */}
        <h4 className="mt-6 font-display text-[16px] font-extrabold leading-snug text-white">{t('ajuda.xp_tiers_title')}</h4>
        <ol className="mt-3 overflow-hidden rounded-[16px] bg-[#1B1D21]">
          {[...XP_TIERS].reverse().map((tier) => (
            <li key={tier.key} className="flex min-h-[52px] items-center gap-3 border-t border-[#2A2D33] px-3.5 py-2 first:border-t-0">
              <span className="w-[18px] text-right font-mono text-[12px] font-medium text-[#7B818C]">{tier.level}</span>
              <img src={`/xp/escudo-${tier.key}.webp`} alt="" width="36" height="36" loading="lazy"
                className="h-9 w-9 flex-none object-contain drop-shadow-[0_3px_6px_rgba(0,0,0,.4)]" />
              <b className="flex-1 font-display text-[15.5px] font-extrabold leading-tight text-white">{t(tier.labelKey)}</b>
              <span className="font-display text-[14px] font-semibold tabular-nums text-[#C4C8CF]">{xpNumber(tier.min, i18n.language)} XP</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[14px] leading-[1.5] text-[#9CA3AF]">{t('ajuda.xp_tiers_note')}</p>

        <h3 className="mt-10 font-display text-[22px] font-extrabold text-white">{t('ajuda.month_title')}</h3>
        <p className="mt-2 text-[16px] leading-[1.55] text-[#C9CDD3]">{t('ajuda.month_body')}</p>
      </Band>

      {/* Para quem organiza: perguntas, para não repetir o «Como funciona»
          (site arrumado, 14 out). */}
      <Band id="organizar" inApp={inApp} className={inApp ? '' : 'bg-white'}>
        <p className={`${SITE_EYEBROW} text-[#5B6068]`}>{t('ajuda.org_eyebrow')}</p>
        <h2 className={`${SITE_H2} mt-3 !text-[34px]`}>{t('ajuda.org_title')}</h2>
        <div className={LIST(inApp)}>
          {ORG.map((i) => (
            <Question key={i} q={t(`ajuda.org_q${i}`)} open={i === 1}><p>{bold(t(`ajuda.org_a${i}`))}</p></Question>
          ))}
        </div>
      </Band>

      {/* Fim preto, até ao fundo: o Alino a pensar num círculo creme (só fica
          bem em fundo claro, 13 out), e um só botão lima. */}
      <Band inApp={inApp} className="bg-ink-900 text-center"
        style={inApp ? { paddingBottom: 'calc(3.5rem + 7rem + env(safe-area-inset-bottom))' } : undefined}>
        <span className="mx-auto grid h-[150px] w-[150px] place-items-center overflow-hidden rounded-full bg-[#F1EFE6]">
          <img src="/ajuda/alino-a-pensar.webp" srcSet="/ajuda/alino-a-pensar@2x.webp 2x" alt="" width="228" height="320" loading="lazy" className="h-[124px] w-auto" />
        </span>
        <h2 className={`${SITE_H2} mt-6 !text-[34px] !text-white`}>{t('ajuda.end_title')}</h2>
        <p className="mt-2 text-[17px] text-[#C9CDD3]">{t('ajuda.end_text')}</p>
        <div className="mx-auto mt-7 flex max-w-[380px] flex-col">
          <a href={whatsappContactLink(t('plans.whatsapp_text'))} target="_blank" rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center rounded-[16px] bg-lime-400 px-4 py-[18px] font-display text-[17px] font-extrabold leading-none text-ink-900">
            {t('landing.organizers_whatsapp')}
          </a>
        </div>
        {SUPPORT_EMAIL_READY && <p className="mt-4 select-all font-display text-[16px] font-bold text-white">{SUPPORT_EMAIL}</p>}
      </Band>
    </div>
  )
}

/** A página do site (/instrucoes, e o /ajuda sem sessão), com o cabeçalho e
 *  o rodapé comuns. */
export default function Instructions() {
  usePageTop()
  return (
    <div className="min-h-screen bg-[#F7F7F4]">
      <SiteHeader />
      <main><HelpContent /></main>
      <SiteFooter />
    </div>
  )
}
