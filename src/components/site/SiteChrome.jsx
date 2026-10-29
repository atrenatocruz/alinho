// O cabeçalho e o rodapé do site, iguais em todas as páginas públicas (site
// arrumado — design-handoff/2026-10-14-site-arrumado, aprovado pelo
// Francisco a 17 out). Também no torneio e nos convites.
//
// As cinco portas, iguais em cima e em baixo e pela mesma ordem: Jogadores ·
// Grupos e clubes · Professores · Parceiros · Ajuda, cada uma com a sua página
// (design-handoff/2026-10-28-site-menu-e-parceiros e 2026-10-28-site-paginas-
// sem-separadores, aprovados pelo Francisco a 28 out).
//
// Cabeçalho, creme e preso em cima. Nenhuma porta fica cortada nem escondida:
//   - numa linha (o logótipo, as cinco, a língua e o «Entrar») só quando a
//     linha inteira cabe com 40 px de folga, medida na hora e na língua em
//     que se está (SPEC 4a: «Pa…» cortado a 1264 px com a conta fixa);
//   - senão, em cima o logótipo, a língua e o «Entrar»; por baixo as cinco,
//     que partem em linhas (no telemóvel, duas), sem deslizar (SPEC 3,
//     «cuidado com as tabs no mobile do menu», Francisco, 28 out).
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
/** As cinco portas, com `on` na página onde se está. A /parceiros existe
 *  sempre: com o interruptor «parceiros» desligado mostra só o «Para marcas e
 *  lojas». */
function useSiteLinks() {
  const { pathname } = useLocation()
  return [
    { to: '/como-funciona', key: 'site.nav_players', on: pathname === '/como-funciona' },
    { to: '/planos', key: 'plans.tab_groups', on: pathname === '/planos' },
    { to: '/professores', key: 'plans.tab_teachers', on: pathname === '/professores' },
    { to: '/parceiros', key: 'partners.footer_link', on: pathname === '/parceiros' },
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
  const linkClass = (on) => `inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap border-b-2 font-display text-[15px] font-bold text-ink-900 sm:text-base ${on ? 'border-lime-400' : 'border-transparent'}`
  const nav = (
    links.map((l) => (
      <Link key={l.key} to={l.to} onClick={toTop(pathname, l.to)} aria-current={l.on ? 'page' : undefined} className={linkClass(l.on)}>
        {t(l.key)}
      </Link>
    ))
  )
  // Uma linha só quando cabe inteira com 40 px de folga, medida com as
  // peças verdadeiras: o logótipo, as cinco (numa cópia escondida, sempre
  // numa linha), a língua e o «Entrar». Volta a medir quando a largura, a
  // língua ou as letras mudam.
  const rowRef = useRef(null)
  const logoRef = useRef(null)
  const endRef = useRef(null)
  const measureRef = useRef(null)
  const [oneLine, setOneLine] = useState(false)
  const tEs = i18n.hasResourceBundle?.('es', 'translation') ? i18n.getFixedT('es') : t
  useLayoutEffect(() => {
    const check = () => {
      const row = rowRef.current
      if (!row || !logoRef.current || !endRef.current || !measureRef.current) return
      const cs = getComputedStyle(row)
      const inner = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const need = logoRef.current.offsetWidth + measureRef.current.scrollWidth + endRef.current.offsetWidth + 2 * 30 + 40
      setOneLine(need <= inner)
    }
    check()
    const ro = new ResizeObserver(check)
    ;[rowRef.current, measureRef.current, endRef.current].forEach((el) => el && ro.observe(el))
    document.fonts?.ready.then(check)
    return () => ro.disconnect()
  }, [])
  return (
    <header ref={ref} className={`${sticky ? 'sticky top-0' : 'relative'} z-20 border-b border-black/5 bg-[#F7F7F4] pt-[env(safe-area-inset-top,0px)]`}>
      <div ref={rowRef} className="mx-auto flex h-16 max-w-[1200px] items-center gap-[30px] px-4 sm:h-[76px] sm:px-10">
        <Link ref={logoRef} to="/" onClick={toTop(pathname, '/')} className="shrink-0 leading-none" aria-label="alinho.pt">
          <Wordmark variant="light" className="!h-[26px] sm:!h-[30px]" />
        </Link>
        <span className="flex-1" />
        {oneLine && <nav className="flex items-center gap-[30px]" aria-label={t('site.nav_label')}>{nav}</nav>}
        {/* A língua ao lado do «Entrar», em todos os tamanhos (menu-lingua, 28 out). */}
        <div ref={endRef} className="flex shrink-0 items-center gap-2 sm:gap-4">
          <LanguageMenu />
          <Link to={cta.to} className="rounded-full bg-ink-900 px-5 py-3 font-display text-[15px] font-extrabold leading-none text-white">
            {cta.label}
          </Link>
        </div>
      </div>
      {/* Sem lugar numa linha: as cinco por baixo, a partir em linhas. Todas à
          vista, sem deslizar nem esbatido. */}
      {!oneLine && (
        <nav className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-5 px-4 pb-1 sm:gap-x-[30px] sm:px-10" aria-label={t('site.nav_label')}>{nav}</nav>
      )}
      {/* A medida das cinco numa linha (escondida, fora do ecrã), na palavra
          mais comprida de cada porta entre a língua de agora e o es, a mais
          comprida (SPEC 4a): a forma não muda ao trocar de língua. */}
      <div aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 h-0 w-0 overflow-hidden">
        <div ref={measureRef} className="flex w-max gap-[30px]">
          {links.map((l) => {
            const a = t(l.key)
            const b = tEs(l.key)
            return <span key={l.key} className={linkClass(false)}>{b.length > a.length ? b : a}</span>
          })}
        </div>
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
