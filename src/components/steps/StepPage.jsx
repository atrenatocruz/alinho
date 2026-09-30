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
//   edit        — só no EDITAR (LEIA-PRIMEIRO, 30 set, aprovado pelo Francisco):
//               { onSave, onCancel, dirty, saving, saveDisabled, saveHint, extra }.
//               Em todos os passos: «Cancelar» na barra de cima (com alterações
//               por guardar pergunta «Sair sem guardar as alterações?»), o
//               «‹» para o passo anterior na barra de progresso, e em baixo
//               «Guardar alterações» (preto) + «Seguinte» (contorno); no último
//               passo só «Guardar alterações». `extra` fica por baixo (ex.: as
//               ações do mix no último passo). No criar, nada disto muda.
//
// Espaço da versão final (26 set): título → nome/barra 24 px, barra → 1.ª
// pergunta 24 px, entre perguntas 24 px, rótulo → campo 8 px (o mb-2 do
// rótulo), último campo → botão 32 px. Nada fica tapado pelo menu de baixo
// (pb-28, pedido do Bugs e da designer).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackBar, ConfirmSheet } from '../ui'
import { ChevronLeft } from 'lucide-react'
import { PrimaryButton } from '../ui'

export default function StepPage({
  title, subtitle = null, step, total, stepLabel, onBack, top = null, children,
  onNext, nextLabel, nextDisabled = false, nextHint = null, footer = null, error = '', busy = false, edit = null,
}) {
  const { t } = useTranslation()
  const stepped = total > 1
  const [asking, setAsking] = useState(false)
  // Sem a barra de baixo enquanto se cria ou edita por passos (30 set).
  useEffect(() => {
    document.body.dataset.steps = '1'
    return () => { delete document.body.dataset.steps }
  }, [])
  const cancelEdit = () => (edit?.dirty ? setAsking(true) : edit.onCancel())
  const last = !stepped || step >= total
  return (
    <div className="mx-auto max-w-lg pb-28">
      {/* «Cancelar / Voltar» sempre visível ao deslizar (27 set). No editar,
          «Cancelar» em todos os passos e o nome do passo no meio (30 set). */}
      {edit
        ? (
          // A mesma barra do BackBar, mas com «Cancelar» escrito (o desenho
          // de 30 set pede a palavra, não só a seta) e o passo no meio.
          <div className="sticky top-0 z-10 -mx-4 -mt-6 mb-1 bg-white/70 px-4 backdrop-blur-md" style={{ paddingTop: 'var(--safe-top, env(safe-area-inset-top))' }}>
            <div className="grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-3">
              <button type="button" onClick={cancelEdit}
                className="h-11 justify-self-start rounded-full bg-white/95 px-4 text-sm font-extrabold text-ink-900 shadow-card">
                {t('steps.cancel')}
              </button>
              <p className="min-w-0 truncate text-center text-base font-extrabold text-ink-900">{stepped ? stepLabel : ''}</p>
              <span aria-hidden />
            </div>
          </div>
        )
        : <BackBar onBack={onBack} label={step === 1 ? t('steps.cancel') : t('common.back')} title={title} />}

      <h2 className="mt-2 text-3xl text-ink-900">{title}</h2>
      {/* «No <grupo>» por baixo de «Novo jogo entre amigos» (27 set). */}
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      {top && <div className="mt-6">{top}</div>}

      {stepped && <div className="mt-6">
        <div className="h-1 overflow-hidden rounded-sm bg-ink-50">
          <i className="block h-full rounded-sm bg-ink-900 transition-all duration-fast" style={{ width: `${(step / total) * 100}%` }} />
        </div>
        <p className="mt-1.5 flex items-center text-xs text-ink-500">
          {/* No editar, o «‹ 2 de 4 · Quando» volta ao passo anterior. */}
          {edit && step > 1 && (
            <button type="button" onClick={onBack} aria-label={t('common.back')}
              className="-my-2 -ml-2 mr-0.5 flex h-8 w-8 items-center justify-center rounded-full text-ink-900 hover:bg-ink-50">
              <ChevronLeft size={16} />
            </button>
          )}
          <span>{t('steps.of', { step, total })} · <b className="font-semibold text-ink-700">{stepLabel}</b></span>
        </p>
      </div>}

      <div className="mt-6 space-y-6">{children}</div>

      {error && (
        <p className="mt-6 rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>
      )}

      {edit ? (
        <div className="mt-8 space-y-2.5">
          <button type="button" onClick={edit.onSave} disabled={edit.saving || edit.saveDisabled}
            className="w-full min-h-[52px] rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
            {edit.saving ? t('steps.saving') : t('steps.save_changes')}
          </button>
          {edit.saveDisabled && edit.saveHint && <p className="text-center text-xs text-muted">{edit.saveHint}</p>}
          {!last && (
            <button type="button" onClick={onNext} disabled={nextDisabled || busy}
              className="w-full min-h-[52px] rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
              {nextLabel || t('steps.next')}
            </button>
          )}
          {!last && nextDisabled && nextHint && <p className="text-center text-xs text-muted">{nextHint}</p>}
          {edit.extra && <div className="pt-4">{edit.extra}</div>}
        </div>
      ) : footer ? <div className="mt-8">{footer}</div> : (
        <div className="mt-8">
          <PrimaryButton onClick={onNext} disabled={nextDisabled || busy} className="w-full">
            {nextLabel || t('steps.next')}
          </PrimaryButton>
          {nextDisabled && nextHint && <p className="mt-1.5 text-center text-xs text-muted">{nextHint}</p>}
        </div>
      )}

      {edit && (
        <ConfirmSheet open={asking} outline title={t('steps.leave_title')}
          cancelLabel={t('steps.keep_editing')} confirmLabel={t('steps.leave_without_saving')}
          onConfirm={() => edit.onCancel()} onClose={() => setAsking(false)} />
      )}
    </div>
  )
}
