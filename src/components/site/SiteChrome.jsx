// O cabeçalho e o rodapé do site, iguais em todas as páginas públicas (site
// arrumado — design-handoff/2026-10-14-site-arrumado, aprovado pelo
// Francisco a 17 out). Também no torneio e nos convites.
//
// As cinco portas, iguais em cima e em baixo e pela mesma ordem: Jogadores ·
// Clubes · Professores · Parceiros · Ajuda (design-handoff/2026-10-28-site-
// menu-e-parceiros, aprovado pelo Francisco a 28 out). Jogadores abre «Como
// funciona»; Clubes e Professores, os Planos no separador certo; Parceiros, a
// /parceiros (ou os Planos em «Parceiros», com o interruptor desligado).
//
// Cabeçalho, creme e preso em cima:
//   - a partir de 1100 px, numa linha: o logótipo à esquerda e, à direita, as
//     cinco, a língua e o «Entrar» em pastilha preta (UX, 28 out, SPEC 4a:
//     com «Colaboradores» em es precisa de ~1016 px);
//   - abaixo disso: em cima o logótipo e «Entrar»; por baixo as cinco, numa
//     fila que desliza, com o esbatido à direita a dizer que há mais.
//   A página onde se está fica sublinhada a lima (2 px).
// Rodapé, preto: em cima as cinco e Novidades (a página onde se está a lima);
// em baixo, pequeno, Privacidade, Termos e «© 2026 alinho.pt», e a língua.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigationType, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Wordmark } from '../Layout'
import { useAuth } from '../../contexts/AuthContext'
import i18n from '../../lib/i18n'
import LanguageMenu from './LanguageMenu'
import { useFeatureFlag } from '../../lib/useFeatureFlag'

/* Estas páginas vivem fora do Layout, que é quem põe as outras no topo.
   Sem isto, «Ver os planos» abria a página Planos lá em baixo, onde estava o
   dedo — parecia que os planos não existiam (Francisco, 26 set). Ao voltar
   atrás, o browser devolve a posição de antes. */
export function usePageTop() {
  const navigationType = useNavigationType()
  useLayoutEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0)
  }, [navigationType])
}

/** O «Entrar» guarda o ?org=<slug> do endereço (o convite de um clube). */
export function useLoginHref() {
  const [params] = useSearchParams()
  const org = params.get('org')
  return (mode) => {
    const q = new URLSearchParams()
    if (mode) q.set('mode', mode)
    if (org) q.set('org', org)
    const s = q.toString()
    return s ? `/login?${s}` : '/login'
  }
}

/** A língua escolhida antes de haver conta: muda já e fica guardada; ao
 *  entrar, passa para a conta (AuthContext, loadProfile). */
export function setSiteLanguage(lang) {
  i18n.changeLanguage(lang)
  try {
    localStorage.setItem('preferredLanguage', lang)
  } catch {
    // ignora — é só para lembrar
  }
}

// A Ajuda vive em /ajuda (o /instrucoes leva lá): sem sessão, a página do
// site; com sessão, dentro da app.
export const HELP_PATH = '/ajuda'
const PLAN_TABS = ['#professores', '#parceiros']

/** O separador dos Planos em que se está. Os Planos trocam de separador sem
 *  passar pelo router (replaceState) e avisam com «site:tab». */
function usePlansHash() {
  const { hash } = useLocation()
  const [now, setNow] = useState(hash)
  useEffect(() => { setNow(hash) }, [hash])
  useEffect(() => {
    const read = () => setNow(window.location.hash)
    window.addEventListener('site:tab', read)
    return () => window.removeEventListener('site:tab', read)
  }, [])
  return now
}

/** As cinco portas, com `on` na página onde se está. «Parceiros» (PO, 19 out):
 *  com o interruptor «parceiros» ligado, a página dos parceiros; desligado, o
 *  separador Parceiros dos Planos, para quem quer ser parceiro. */
function useSiteLinks() {
  const { on: partnersOn } = useFeatureFlag('parceiros')
  const { pathname } = useLocation()
  const hash = usePlansHash()
  const onPlans = pathname === '/planos'
  return [
    { to: '/como-funciona', key: 'site.nav_players', on: pathname === '/como-funciona' },
    { to: '/planos', key: 'site.nav_clubs', on: onPlans && !PLAN_TABS.includes(hash) },
    { to: '/planos#professores', key: 'plans.tab_teachers', on: onPlans && hash === '#professores' },
    { to: partnersOn ? '/parceiros' : '/planos#parceiros', key: 'partners.footer_link', on: pathname === '/parceiros' || (onPlans && hash === '#parceiros') },
    { to: HELP_PATH, key: 'site.help_link', on: ['/instrucoes', '/ajuda'].includes(pathname) },
  ]
}
const LEGAL_LINKS = [
  { to: '/privacidade', key: 'landing.privacy_link' },
  { to: '/termos', key: 'landing.terms_link' },
]

// Os links abrem a página no topo; na própria página, voltar ao topo.
const toTop = (pathname, to) => () => { if (pathname === to) window.scrollTo(0, 0) }

/** `sticky`: preso em cima (as páginas do site). Nas páginas de evento sem
 *  sessão (torneio, convites) não se prende: sobe com a página, e a barra de
 *  vidro do evento começa por baixo dele e prende-se no topo quando ele sai
 *  (UX, 18 out). Para isso diz onde acaba, em --site-bottom. */
export function SiteHeader({ sticky = true }) {
  const { t } = useTranslation()
  const ref = useRef(null)
  // Preso: diz a sua altura em --site-head, para as barras presas da página
  // (os separadores dos Planos, o índice da Ajuda) ficarem logo por baixo.
  useEffect(() => {
    if (!sticky || !ref.current) return undefined
    const root = document.documentElement
    const ro = new ResizeObserver(() => root.style.setProperty('--site-head', `${ref.current?.offsetHeight || 0}px`))
    ro.observe(ref.current)
    return () => { ro.disconnect(); root.style.removeProperty('--site-head') }
  }, [sticky])
  useEffect(() => {
    if (sticky) return undefined
    const root = document.documentElement
    const update = () => {
      const b = ref.current ? Math.max(0, ref.current.getBoundingClientRect().bottom) : 0
      root.style.setProperty('--site-bottom', `${Math.round(b)}px`)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      root.style.removeProperty('--site-bottom')
    }
  }, [sticky])
  const { pathname } = useLocation()
  const loginHref = useLoginHref()
  // Com sessão iniciada, a pastilha leva de volta à app, em vez de pedir
  // para entrar outra vez — o Francisco ficou preso nos Planos (UX, 18 out).
  const { user } = useAuth()
  const cta = user ? { to: '/', label: t('site.open_app') } : { to: loginHref(), label: t('landing.login_link') }
  const links = useSiteLinks()
  const nav = (
    links.map((l) => (
      <Link key={l.key} to={l.to} onClick={toTop(pathname, l.to)} aria-current={l.on ? 'page' : undefined}
        className={`inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap border-b-2 font-display text-[15px] font-bold text-ink-900 sm:text-base ${l.on ? 'border-lime-400' : 'border-transparent'}`}>
        {t(l.key)}
      </Link>
    ))
  )
  // Na fila que desliza, a página onde se está fica à vista.
  const rowRef = useRef(null)
  const onIndex = links.findIndex((l) => l.on)
  useEffect(() => {
    // Depois de pintar e outra vez com as letras carregadas (mudam a largura);
    // tem de passar o esbatido (40 px) para se ler inteira (QA, 28 out).
    const go = () => {
      const row = rowRef.current
      const el = row?.querySelector('[aria-current="page"]')
      if (!row || !el) return
      const over = el.getBoundingClientRect().right - (row.getBoundingClientRect().right - 48)
      if (over > 0) row.scrollLeft += over
    }
    const id = requestAnimationFrame(go)
    document.fonts?.ready.then(go)
    return () => cancelAnimationFrame(id)
  }, [pathname, onIndex])
  return (
    <header ref={ref} className={`${sticky ? 'sticky top-0' : 'relative'} z-20 border-b border-black/5 bg-[#F7F7F4] pt-[env(safe-area-inset-top,0px)]`}>
      <div className="mx-auto flex max-w-[1200px] items-center gap-[30px] px-4 sm:h-[76px] sm:px-10">
        <div className="flex h-16 flex-1 items-center justify-between sm:h-auto sm:flex-none">
          <Link to="/" onClick={toTop(pathname, '/')} className="shrink-0 leading-none" aria-label="alinho.pt">
            <Wordmark variant="light" className="!h-[26px] sm:!h-[30px]" />
          </Link>
          {/* Telemóvel: o menu da língua ao lado do «Ir à app» (menu-lingua, 28 out). */}
          <div className="flex items-center gap-2 sm:hidden">
            <LanguageMenu />
            <Link to={cta.to} className="rounded-full bg-ink-900 px-5 py-3 font-display text-[15px] font-extrabold leading-none text-white">
              {cta.label}
            </Link>
          </div>
        </div>
        <span className="hidden flex-1 sm:block" />
        <nav className="hidden items-center gap-[30px] min-[1100px]:flex" aria-label={t('site.nav_label')}>{nav}</nav>
        <LanguageMenu className="hidden sm:block" />
        <Link to={cta.to} className="hidden rounded-full bg-ink-900 px-5 py-3 font-display text-[15px] font-extrabold leading-none text-white sm:inline-block">
          {cta.label}
        </Link>
      </div>
      {/* Abaixo de 1100 px: as cinco numa segunda linha, que desliza; o
          esbatido à direita diz que há mais. */}
      <div className="relative mx-auto max-w-[1200px] min-[1100px]:hidden">
        <nav ref={rowRef} className="no-scrollbar flex items-center gap-[30px] overflow-x-auto px-4 pb-1 pr-10 sm:px-10" aria-label={t('site.nav_label')}>{nav}</nav>
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#F7F7F4]" />
      </div>
    </header>
  )
}

export function SiteFooter() {
  const { t } = useTranslation()
  const links = useSiteLinks()
  const { pathname } = useLocation()
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-[#1E2127] bg-ink-900 px-4 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] pt-8 sm:px-10 sm:py-[30px]">
      <div className="mx-auto max-w-[1200px]">
        <nav className="flex flex-wrap items-center justify-center gap-x-[26px] gap-y-1 sm:justify-start" aria-label={t('site.footer_label')}>
          {[...links, { to: '/novidades', key: 'nov.footer_link', on: pathname === '/novidades' }].map((l) => (
            <Link key={l.key} to={l.to} onClick={toTop(pathname, l.to)} aria-current={l.on ? 'page' : undefined}
              className={`inline-flex min-h-[44px] items-center font-display text-[15px] font-bold ${l.on ? 'text-lime-400' : 'text-[#E6E8EB] hover:text-white'}`}>
              {t(l.key)}
            </Link>
          ))}
        </nav>
        {/* Em baixo, pequeno, o que é legal; a língua à direita no computador
            e por cima, ao centro, no telemóvel. */}
        <div className="mt-4 flex flex-col-reverse items-center gap-4 sm:flex-row sm:justify-between">
        <div className="flex flex-wrap items-center justify-center gap-x-5">
          {LEGAL_LINKS.map((l) => (
            <Link key={l.to} to={l.to} onClick={toTop(pathname, l.to)} aria-current={pathname === l.to ? 'page' : undefined}
              className={`inline-flex min-h-[44px] items-center font-sans text-[13px] ${pathname === l.to ? 'text-lime-400' : 'text-[#9AA0AA] hover:text-white'}`}>
              {t(l.key)}
            </Link>
          ))}
          <p className="font-sans text-[13px] text-[#7B818C]">&copy; {year} alinho.pt</p>
        </div>
        <LanguageMenu tone="dark" />
        </div>
      </div>
    </footer>
  )
}
