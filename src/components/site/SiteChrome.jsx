// O cabeçalho e o rodapé do site, iguais em todas as páginas públicas (site
// arrumado — design-handoff/2026-10-14-site-arrumado, aprovado pelo
// Francisco a 17 out). Também no torneio e nos convites.
//
// Cabeçalho, creme e preso em cima:
//   - computador: numa linha, o logótipo à esquerda e, à direita, Como
//     funciona · Planos · Ajuda · EN · «Entrar» em pastilha preta;
//   - telemóvel: em cima o logótipo e «Entrar»; por baixo os três links (o EN
//     passa para o rodapé). O Ajuda nunca sai.
//   A página onde se está fica sublinhada a lima (2 px).
// Rodapé, preto: os seis links (a página onde se está a lima), «Português |
// English» e «© 2026 alinho.pt». No computador numa linha só.
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Link, useLocation, useNavigationType, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Wordmark } from '../Layout'
import { useAuth } from '../../contexts/AuthContext'
import i18n from '../../lib/i18n'

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

// A Ajuda do site vive, por agora, nas Instruções (/instrucoes); a Ajuda nova
// em /ajuda vem a seguir (#658) e muda só aqui.
export const HELP_PATH = '/instrucoes'
const LINKS = [
  { to: '/como-funciona', key: 'hiw.nav_link', paths: ['/como-funciona'] },
  { to: '/planos', key: 'landing.pricing_nav_link', paths: ['/planos'] },
  { to: HELP_PATH, key: 'site.help_link', paths: ['/instrucoes', '/ajuda'] },
]
const FOOTER_LINKS = [
  ...LINKS,
  { to: '/novidades', key: 'nov.footer_link', paths: ['/novidades'] },
  { to: '/privacidade', key: 'landing.privacy_link', paths: ['/privacidade'] },
  { to: '/termos', key: 'landing.terms_link', paths: ['/termos'] },
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
  const nav = (
    LINKS.map((l) => {
      const on = l.paths.includes(pathname)
      return (
        <Link key={l.to} to={l.to} onClick={toTop(pathname, l.to)} aria-current={on ? 'page' : undefined}
          className={`inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 font-display text-[15px] font-bold text-ink-900 sm:text-base ${on ? 'border-lime-400' : 'border-transparent'}`}>
          {t(l.key)}
        </Link>
      )
    })
  )
  return (
    <header ref={ref} className={`${sticky ? 'sticky top-0' : 'relative'} z-20 border-b border-black/5 bg-[#F7F7F4] pt-[env(safe-area-inset-top,0px)]`}>
      <div className="mx-auto flex max-w-[1200px] items-center gap-[30px] px-4 sm:h-[76px] sm:px-10">
        <div className="flex h-16 flex-1 items-center justify-between sm:h-auto sm:flex-none">
          <Link to="/" onClick={toTop(pathname, '/')} className="shrink-0 leading-none" aria-label="alinho.pt">
            <Wordmark variant="light" className="!h-[26px] sm:!h-[30px]" />
          </Link>
          <Link to={cta.to} className="rounded-full bg-ink-900 px-5 py-3 font-display text-[15px] font-extrabold leading-none text-white sm:hidden">
            {cta.label}
          </Link>
        </div>
        <span className="hidden flex-1 sm:block" />
        <nav className="hidden items-center gap-[30px] sm:flex" aria-label={t('site.nav_label')}>{nav}</nav>
        <button type="button" onClick={() => setSiteLanguage(i18n.language === 'en' ? 'pt' : 'en')} title={t('layout.toggle_language')}
          className="hidden min-h-[44px] items-center font-display text-sm font-semibold text-[#4F535A] hover:text-ink-900 sm:inline-flex">
          {i18n.language === 'en' ? 'PT' : 'EN'}
        </button>
        <Link to={cta.to} className="hidden rounded-full bg-ink-900 px-5 py-3 font-display text-[15px] font-extrabold leading-none text-white sm:inline-block">
          {cta.label}
        </Link>
      </div>
      {/* Telemóvel: os links numa segunda linha. */}
      <nav className="flex items-center gap-[30px] px-4 pb-1 sm:hidden" aria-label={t('site.nav_label')}>{nav}</nav>
    </header>
  )
}

export function SiteFooter() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const year = new Date().getFullYear()
  const lang = i18n.language === 'en' ? 'en' : 'pt'
  const pill = (on) => `rounded-full border px-[13px] py-2 font-display text-[13px] font-semibold leading-none ${
    on ? 'border-white bg-white text-ink-900' : 'border-[#2E3137] text-[#C4C8CF] hover:text-white'}`
  return (
    <footer className="border-t border-[#1E2127] bg-ink-900 px-4 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] pt-8 sm:px-10 sm:py-[30px]">
      <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-5 sm:flex-row sm:justify-between">
        <nav className="flex flex-wrap items-center justify-center gap-x-[26px] gap-y-1" aria-label={t('site.footer_label')}>
          {FOOTER_LINKS.map((l) => (
            <Link key={l.to} to={l.to} onClick={toTop(pathname, l.to)} aria-current={l.paths.includes(pathname) ? 'page' : undefined}
              className={`inline-flex min-h-[44px] items-center font-display text-[15px] font-bold ${l.paths.includes(pathname) ? 'text-lime-400' : 'text-[#E6E8EB] hover:text-white'}`}>
              {t(l.key)}
            </Link>
          ))}
        </nav>
        <div className="flex gap-1.5" role="group" aria-label={t('layout.toggle_language')}>
          <button type="button" aria-pressed={lang === 'pt'} onClick={() => setSiteLanguage('pt')} className={pill(lang === 'pt')}>{t('profile.language_portuguese')}</button>
          <button type="button" aria-pressed={lang === 'en'} onClick={() => setSiteLanguage('en')} className={pill(lang === 'en')}>{t('profile.language_english')}</button>
        </div>
        <p className="font-sans text-[13px] text-[#7B818C]">&copy; {year} alinho.pt</p>
      </div>
    </footer>
  )
}
