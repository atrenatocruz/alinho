import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alino from '../Alino'

/* Enquanto a IA escolhe (5–15 s): o Alino a saltar com a sombra no chão, três
   pontos e uma frase que vai mudando (Renato, 27 out: «uma animação para não
   ficar só uma imagem estática»). Com «reduzir movimento» fica tudo parado e só
   a frase muda. As animações estão em src/index.css (.raq-*). */
const STEPS = ['raquete.searching_1', 'raquete.searching_2', 'raquete.searching_3', 'raquete.searching_4']

export default function RaqueteAProcurar() {
  const { t } = useTranslation()
  const [i, setI] = useState(0)
  useEffect(() => {
    // A última frase fica: a espera pode passar dos 10 s.
    const id = setInterval(() => setI((n) => Math.min(n + 1, STEPS.length - 1)), 2600)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center" role="status" aria-live="polite">
      <div className="relative">
        <div className="raq-bob"><Alino pose="a-pensar" size={140} /></div>
        <div className="raq-shadow mx-auto mt-1 h-3 w-24 rounded-[50%] bg-ink-900/15" aria-hidden="true" />
      </div>
      <h1 className="mt-6 font-display text-[22px] font-black leading-tight text-ink-900 [text-wrap:balance]">
        {t('raquete.thinking_title')}
      </h1>
      <p key={i} className="mt-2 min-h-[2.75rem] text-[14px] text-muted animate-fade-in [text-wrap:balance]">{t(STEPS[i])}</p>
      <div className="mt-3 flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((d) => <span key={d} className="raq-dot h-2 w-2 rounded-full bg-lime-400" style={{ animationDelay: `${d * 160}ms` }} />)}
      </div>
    </div>
  )
}
