import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SiteHeader, SiteFooter, usePageTop } from '../components/site/SiteChrome'
import DeleteAccountSection from '../components/DeleteAccountSection'
import { useAuth } from '../contexts/AuthContext'
import { ACCOUNT_DELETION_GRACE_DAYS } from '../lib/account'
import { SUPPORT_EMAIL, mailtoLink, whatsappContactLink } from '../lib/contacts'

/* alinho.pt/apagar-conta — a página pública que as lojas pedem (Google Play,
   «Segurança dos dados»: um link onde se pode pedir para apagar a conta sem
   instalar a app). Abre com ou sem sessão. Com sessão, o mesmo «Apagar a
   minha conta» do Perfil (DeleteAccountSection, 30 dias para voltar atrás);
   sem sessão, os passos e, para quem não consegue entrar, o pedido por email
   ou WhatsApp — que o super admin trata no «Apagar uma conta» do Gerir. */
export default function DeleteAccountPage() {
  usePageTop()
  const { t } = useTranslation()
  const { user, profile } = useAuth()
  const days = ACCOUNT_DELETION_GRACE_DAYS
  const h2 = 'mb-2.5 text-[22px] font-extrabold leading-tight tracking-[-0.015em] text-ink-900'
  const p = 'mb-3 max-w-[65ch] text-base leading-[1.65] text-ink-700'
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <header className="bg-[#F7F7F4]">
        <div className="mx-auto max-w-[760px] px-5 pt-8 pb-10 sm:pt-12 sm:pb-14">
          <h1 className="text-[40px] font-black leading-[1.05] tracking-[-0.03em] text-ink-900 sm:text-[56px]">{t('deletepage.title')}</h1>
          <p className="mt-2.5 text-[17px] leading-normal text-ink-700">{t('deletepage.lead')}</p>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-5">
        <section className="pt-[30px] pb-[22px]">
          <h2 className={h2}>{t('deletepage.how_title')}</h2>
          {user ? (
            <>
              <p className={p}>{t('deletepage.signed_in', { name: profile?.name || user.email || '' })}</p>
              <DeleteAccountSection />
            </>
          ) : (
            <>
              <ol className="mb-4 grid max-w-[65ch] gap-2 pl-6 text-base leading-[1.65] text-ink-700 list-decimal">
                <li>{t('deletepage.step_1')}</li>
                <li>{t('deletepage.step_2')}</li>
                <li>{t('deletepage.step_3')}</li>
              </ol>
              <Link to="/login?redirect=%2Fapagar-conta" className="inline-block rounded-[14px] bg-ink-900 px-5 py-3.5 text-[15px] font-extrabold text-white">
                {t('deletepage.go_login')}
              </Link>
            </>
          )}
        </section>

        <section className="border-t border-line pt-[30px] pb-[22px]">
          <h2 className={h2}>{t('deletepage.what_title')}</h2>
          <ul className="grid max-w-[65ch] gap-2 text-base leading-[1.65] text-ink-700">
            <li>• {t('deleteaccount.what_goes')}</li>
            <li>• {t('deleteaccount.what_stays')}</li>
            <li>• {t('deletepage.grace', { days })}</li>
          </ul>
        </section>

        <div className="mt-5 mb-10 rounded-[22px] bg-[#F7F7F4] px-[22px] py-6">
          <h2 className="mb-1.5 text-[22px] font-extrabold leading-tight text-ink-900">{t('deletepage.no_access_title')}</h2>
          <p className="mb-4 text-muted">{t('deletepage.no_access_body')}</p>
          <div className="flex max-w-[360px] flex-col gap-2.5">
            <a href={mailtoLink(t('deletepage.email_subject'))} className="rounded-[14px] bg-ink-900 p-3.5 text-center text-[15px] font-extrabold text-white">{SUPPORT_EMAIL}</a>
            <a href={whatsappContactLink(t('deletepage.whatsapp_text'))} target="_blank" rel="noopener noreferrer"
              className="rounded-[14px] border-[1.5px] border-[#CFD2D7] bg-white p-3.5 text-center text-[15px] font-extrabold text-ink-900">{t('terms.help_whatsapp')}</a>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
