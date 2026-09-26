// A moldura de criar qualquer evento por passos (#342, Francisco 26 set:
// «todos os jogos com a mesma lógica»). Uma só, para o mix e a turma (Bugs)
// e para o jogo entre amigos, o de grupo e os em aberto (Dev 2).
//
// Regras por cima (design-handoff/2026-09-23-criar-eventos/LEIA-PRIMEIRO.md):
// página própria; «← Cancelar» no 1.º passo e «← Voltar» nos outros; o nome
// (quando o evento o tem) por cima da barra, sempre à vista; a barra de
// progresso «N de M · <passo>» — nunca pastilhas, que passos não são
// separadores; «Seguinte» a lima em baixo.
//
// Props:
//   title       — «Novo jogo entre amigos»
//   step, total — 1-based
//   stepLabel   — «Pessoas», «Quando»…
//   onBack      — chamado por «← Cancelar» (passo 1) e «← Voltar» (outros)
//   top         — opcional: o que fica por cima da barra (o nome do mix)
//   children    — o passo
//   onNext, nextLabel = «Seguinte», nextDisabled, nextHint (frase por baixo
//               quando o Seguinte está apagado)
//   footer      — opcional: substitui o botão de baixo (ex.: «Publicar mix»
//               + «Guardar como rascunho» no último passo)
//   error       — frase de erro por cima do botão
//   busy        — o botão de baixo fica apagado enquanto grava (o texto
//               muda-o quem chama, com nextLabel)
//   Sem passos (total ≤ 1, ou sem total): não se desenha a barra — é o
//   formulário de uma página só, como editar um torneio com inscrições.
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { PrimaryButton } from '../ui'

export default function StepPage({
  title, step, total, stepLabel, onBack, top = null, children,
  onNext, nextLabel, nextDisabled = false, nextHint = null, footer = null, error = '', busy = false,
}) {
  const { t } = useTranslation()
  const stepped = total > 1
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-extrabold text-ink-700">
        <ArrowLeft size={20} />
        {step === 1 ? t('steps.cancel') : t('common.back')}
      </button>

      <h2 className="text-3xl text-ink-900">{title}</h2>
      {top}

      {stepped && <div>
        <div className="h-1 overflow-hidden rounded-sm bg-ink-50">
          <i className="block h-full rounded-sm bg-ink-900 transition-all duration-fast" style={{ width: `${(step / total) * 100}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-ink-500">
          {t('steps.of', { step, total })} · <b className="font-semibold text-ink-700">{stepLabel}</b>
        </p>
      </div>}

      <div className="space-y-5">{children}</div>

      {error && (
        <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>
      )}

      {footer || (
        <div>
          <PrimaryButton onClick={onNext} disabled={nextDisabled || busy} className="w-full">
            {nextLabel || t('steps.next')}
          </PrimaryButton>
          {nextDisabled && nextHint && <p className="mt-1.5 text-center text-xs text-muted">{nextHint}</p>}
        </div>
      )}
    </div>
  )
}
