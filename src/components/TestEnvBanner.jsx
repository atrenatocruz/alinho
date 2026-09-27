// A faixa «Ambiente de testes» (#585, design-handoff/2026-09-27-site-de-testes).
// Só no site de testes (IS_TEST_ENV), nunca no alinho.pt. Cor de laranja
// #EA580C — a app não usa cor de laranja em mais sítio nenhum, e não deve.
//
// Fica no topo do documento, antes da app, e presa (sticky) ao descer. Não
// tapa nada: a app começa por baixo dela (--tb-h, em index.css, encolhe o
// Layout e baixa as janelas que abrem por cima), e é ela que ocupa o espaço
// das horas do telemóvel — o «Voltar» preso fica logo por baixo.
import { useTranslation } from 'react-i18next'
import { IS_TEST_ENV } from '../lib/appEnv'

export default function TestEnvBanner() {
  const { t } = useTranslation()
  if (!IS_TEST_ENV) return null
  return (
    <div
      role="note"
      className="sticky top-0 z-[70] bg-[#EA580C] text-white"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <p className="flex h-6 items-center justify-center truncate px-4 text-[11px] leading-none">
        <b className="font-extrabold">{t('testenv.banner_lead')}</b>
        <span className="ml-1">· {t('testenv.banner_rest')}</span>
      </p>
    </div>
  )
}
