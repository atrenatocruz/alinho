// «Sem hora» no lugar da hora grande (UX, 21 out: o «—» sozinho saiu, regra
// «Esconder o vibe coding»). Mais pequeno do que a hora, para não parecer um
// número; na faixa de cor fica branco mais suave, no fundo branco a cinzento.
import { useTranslation } from 'react-i18next'

// `label`: outro texto no mesmo lugar (um torneio sem dia: «Dia por definir»).
// `small`: numa coluna estreita (a hora da pesquisa), mais pequeno e numa linha.
export default function NoTime({ onBand = false, label = null, small = false }) {
  const { t } = useTranslation()
  return (
    <span className={`${small ? 'text-[11px]' : 'text-[13px]'} whitespace-nowrap font-semibold tracking-normal ${onBand ? 'opacity-85' : 'text-[#6B7280]'}`}>
      {label || t('ui.empty_no_time')}
    </span>
  )
}
