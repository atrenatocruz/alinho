import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SiteHeader, SiteFooter, useLoginHref, usePageTop, HELP_PATH } from '../components/site/SiteChrome'
import { SITE_EYEBROW, SITE_H2, SITE_LEAD, SITE_ILL } from '../components/site/SiteWays'
import { SITE_DARK } from '../components/site/MedalShowcase'

/* alinho.pt/como-funciona — o site arrumado (design-handoff/2026-10-14-site-
   arrumado, computador/como-funciona.html; aprovado pelo Francisco a 17 out).
   Lê-se de cima para baixo: sem os botões que saltavam para o meio e sem as
   perguntas frequentes (vivem na Ajuda). No computador, cada secção em duas
   colunas, o texto e o telemóvel, com os lados a alternar; no telemóvel,
   uma coluna. Os textos aprovados a 10 e 12 out não mudam.

   Só o que está na app; nada de números, pessoas ou clubes reais. As imagens
   são da conta de exemplo (Rita Figueira, Maré Alta), com «Imagem
   ilustrativa». */

// **In** → In a negrito (o que se escreve no WhatsApp).
const bold = (text, dark) => text.split('**').map((part, i) => (i % 2 ? <b key={i} className={`font-extrabold ${dark ? 'text-white' : 'text-ink-900'}`}>{part}</b> : part))

function Point({ title, body, dark = false, dot = null }) {
  return (
    <div>
      <h3 className={`flex items-center gap-2.5 font-display text-[18px] font-extrabold leading-[1.25] lg:text-[19px] ${dark ? 'text-white' : 'text-ink-900'}`}>
        {dot && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} />}
        {title}
      </h3>
      <p className={`mt-1.5 max-w-[46ch] text-[16px] leading-[1.6] ${dark ? 'text-[#AEB3BB]' : 'text-[#5B6068]'}`}>{bold(body, dark)}</p>
    </div>
  )
}

// A imagem num telemóvel escuro, com «Imagem ilustrativa». No telemóvel fica
// cortada em baixo; no computador inteira, com 340 px (300 no Gerir).
function Phone({ src, small = false, dark = false }) {
  const { t } = useTranslation()
  return (
    <div>
      <div className={`mx-auto ${small ? 'w-[240px] lg:w-[300px]' : 'w-[240px] lg:w-[340px]'}`}>
        <div className="h-[360px] overflow-hidden lg:h-auto">
          <div className="rounded-[38px] bg-[#0B0C0E] p-2 shadow-[0_30px_60px_-30px_rgba(17,17,17,0.45)] lg:rounded-[48px] lg:p-3">
            <img src={src} alt="" width="540" height="1169" loading="lazy" decoding="async" className="block w-full rounded-[30px] lg:rounded-[37px]" />
          </div>
        </div>
      </div>
      <p className={`${SITE_ILL} ${dark ? '!text-[#7B818C]' : ''}`}>{t('hiw.illustrative')}</p>
    </div>
  )
}

/** Uma secção: o texto e o telemóvel lado a lado no computador (`rev`: o
 *  telemóvel à esquerda), um por baixo do outro no telemóvel. */
function Section({ bg, style, eyebrow, eyebrowColor, title, image, rev = false, small = false, dark = false, wide = false, children }) {
  return (
    <section className={`py-16 lg:py-[110px] ${bg || ''}`} style={style}>
      <div className={`mx-auto grid max-w-[1200px] items-center gap-10 px-5 lg:gap-20 lg:px-10 ${wide ? 'lg:grid-cols-[1.25fr_.75fr]' : 'lg:grid-cols-2'}`}>
        <div className={rev ? 'lg:order-2' : ''}>
          <p className={SITE_EYEBROW} style={{ color: eyebrowColor }}>{eyebrow}</p>
          <h2 className={`${SITE_H2} mt-3 ${dark ? '!text-white' : ''}`}>{title}</h2>
          {children}
        </div>
        <Phone src={image} small={small} dark={dark} />
      </div>
    </section>
  )
}

const FEATS = 'mt-8 grid gap-[22px] lg:mt-[34px]'
const GRID2 = 'mt-8 grid gap-[22px] lg:mt-9 lg:grid-cols-2 lg:gap-x-10 lg:gap-y-[26px]'

export default function HowItWorks() {
  usePageTop()
  const { t } = useTranslation()
  const loginHref = useLoginHref()
  const p = (prefix, i, extra = {}) => <Point key={i} title={t(`${prefix}_p${i}_t`)} body={t(`${prefix}_p${i}_b`)} {...extra} />
  return (
    <div className="min-h-screen bg-[#F7F7F4]">
      <SiteHeader />
      <section className="bg-[#F7F7F4] pb-12 pt-10 lg:pb-20 lg:pt-[90px]">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-10">
          <h1 className="max-w-[14ch] font-display text-[40px] font-black leading-[1.02] tracking-[-.035em] text-ink-900 [text-wrap:balance] sm:text-[56px] lg:text-[76px] lg:leading-none">
            {t('hiw.title')}
          </h1>
          <p className={`${SITE_LEAD} lg:!max-w-[40ch]`}>{t('hiw.intro')}</p>
        </div>
      </section>

      <Section style={{ background: '#EEF3FF' }} eyebrow={t('hiw.mix_eyebrow')} eyebrowColor="#1D4ED8" title={t('hiw.mix_title')} image="/como-funciona/mix-exemplo.webp">
        <div className={FEATS}>{[1, 2, 3].map((i) => p('hiw.mix', i))}</div>
      </Section>

      {/* Ranking e conquistas: escura, como na página de entrada. */}
      <Section bg={SITE_DARK} dark rev eyebrow={t('hiw.rank_eyebrow')} eyebrowColor="#C5DD01" title={t('hiw.rank_title')} image="/como-funciona/perfil-exemplo.webp">
        <div className={GRID2}>
          <Point dark title={t('hiw.level_p1_t')} body={t('hiw.level_p1_b')} />
          <Point dark title={t('hiw.level_p3_t')} body={t('hiw.level_p3_b')} />
          <Point dark title={t('hiw.rank_p2_t')} body={t('hiw.rank_p2_b')} />
          <Point dark title={t('hiw.rank_p3_t')} body={t('hiw.rank_p3_b')} />
          <Point dark title={t('hiw.rank_p4_t')} body={t('hiw.rank_p4_b')} />
        </div>
      </Section>

      <Section bg="bg-white" eyebrow={t('hiw.others_eyebrow')} eyebrowColor="#5B6068" title={t('hiw.others_title')} image="/como-funciona/clube-exemplo.webp">
        <div className={FEATS}>
          {p('hiw.others', 1)}
          {p('hiw.others', 2, { dot: '#374151' })}
          {p('hiw.others', 3, { dot: '#C2410C' })}
        </div>
      </Section>

      <Section style={{ background: '#F3EEFF' }} rev eyebrow={t('hiw.tour_eyebrow')} eyebrowColor="#5B21B6" title={t('hiw.tour_title')} image="/como-funciona/torneio-exemplo.webp">
        <div className={FEATS}>{[1, 2].map((i) => p('hiw.tour', i))}</div>
      </Section>

      <Section bg="bg-white" wide small eyebrow={t('hiw.org_eyebrow')} eyebrowColor="#5B6068" title={t('hiw.org_title')} image="/como-funciona/gerir-exemplo.webp">
        <div className={GRID2}>{[1, 2, 3, 4, 5, 6].map((i) => p('hiw.org', i))}</div>
        <p className="mt-8 text-[14px] text-[#5B6068]">
          {t('hiw.org_start')}{' '}
          <Link to="/planos" className="font-bold text-ink-900">{t('hiw.org_plans_link')}</Link>
        </p>
      </Section>

      {/* Fim preto: uma só ação lima, os botões empilhados; as dúvidas vão
          para a Ajuda. */}
      <section className="bg-ink-900 px-5 pb-16 pt-16 text-center lg:pb-[90px] lg:pt-[110px]">
        <div className="mx-auto max-w-[1200px]">
          <h2 className={`${SITE_H2} !text-white`}>{t('hiw.end_title')}</h2>
          <div className="mx-auto mt-8 flex max-w-[380px] flex-col gap-3">
            <Link to={loginHref('signup')} className="inline-flex w-full items-center justify-center rounded-[16px] bg-lime-400 px-4 py-[18px] font-display text-[17px] font-extrabold leading-none text-ink-900">
              {t('landing.signup_link')}
            </Link>
            <Link to={loginHref()} className="inline-flex w-full items-center justify-center rounded-[16px] border-[1.5px] border-[#3A3D42] px-4 py-[18px] font-display text-[17px] font-extrabold leading-none text-white">
              {t('landing.already_account_link')}
            </Link>
          </div>
          <p className="mt-6 text-[16px] text-[#C4C8CF]">
            {t('hiw.end_help')}{' '}
            <Link to={HELP_PATH} className="font-bold text-lime-400">{t('hiw.end_help_link')}</Link>
          </p>
        </div>
      </section>
      <SiteFooter />
    </div>
  )
}
