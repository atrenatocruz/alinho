import { useEffect, useState } from 'react'
import { useFeatureFlag } from '../../lib/useFeatureFlag'
import { hasMyPick } from '../../lib/raquete'
import RacketShape from './RacketShape'

/* A linha «Escolhe a tua raquete» no «Para ti» da Home (design-handoff/
   2026-10-27-raquete, ponto 14, aprovado a 28 out): só com o interruptor
   «raquete» ligado e só a quem ainda não respondeu. Vem depois do que tem a
   ver com jogos (a Home junta-a no fim). Na dúvida (erro), não aparece. */
export function useRaqueteForYou(t) {
  const { on } = useFeatureFlag('raquete')
  const [answered, setAnswered] = useState(true)
  useEffect(() => {
    if (!on) return undefined
    let stale = false
    hasMyPick().then((yes) => { if (!stale) setAnswered(yes) }).catch(() => {})
    return () => { stale = true }
  }, [on])
  if (!on || answered) return []
  return [{
    key: 'raquete',
    icon: <RacketShape shape="lagrima" className="h-6 w-4 text-ink-900" />,
    bg: '#F4F5F1',
    title: t('raquete.card_title'),
    sub: t('raquete.foryou_sub'),
    to: '/perfil/raquete/perguntas',
    cta: t('raquete.start'),
  }]
}
