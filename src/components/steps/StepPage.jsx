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
//   edit        — só no EDITAR (LEIA-PRIMEIRO, «30 SET (2.ª versão) — NO
//               EDITAR: AÇÕES TODAS EM BAIXO», aprovado pelo Francisco):
//               { onSave, onCancel, dirty, saving, saveDisabled, saveHint, danger }.
//               Em cima só a seta ‹ (sai; com alterações por guardar pergunta
//               «Sair sem guardar as alterações?»); o «‹» da barra de progresso
//               volta ao passo anterior. Em baixo, empilhados a toda a largura:
//               «Seguinte» (preto), «Guardar alterações» (contorno; no último
//               passo passa a preto) e o destrutivo (contorno vermelho).
//               danger = { label, title, message, confirmLabel, cancelLabel,
//               onConfirm, errorOf } — a pergunta é a folha da app.
//
// Espaço da versão final (26 set): título → nome/barra 24 px, barra → 1.ª
// pergunta 24 px, entre perguntas 24 px, rótulo → campo 8 px (o mb-2 do
// rótulo), último campo → botão 32 px. Nada fica tapado pelo menu de baixo
// (pb-28, pedido do Bugs e da designer).
import { useEffect, useRef, useState } from 'react'
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
  const [askingDanger, setAskingDanger] = useState(false)
  // Editar: barra de cima com fundo branco sólido e a linha fina quando o
  // título já passou por baixo dela (designer, 30 set).
  const titleRef = useRef(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    if (!edit || !titleRef.current || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { rootMargin: '-64px 0px 0px 0px' })
    io.observe(titleRef.current)
    return () => io.disconnect()
  }, [!!edit]) // eslint-disable-line react-hooks/exhaustive-deps
  // Sem a barra de baixo enquanto se cria ou edita por passos (30 set).
  useEffect(() => {
    document.body.dataset.steps = '1'
    return () => { delete document.body.dataset.steps }
  }, [])
  const cancelEdit = () => (edit?.dirty ? setAsking(true) : edit.onCancel())
  const last = !stepped || step >= total
  const black = 'w-full min-h-[52px] rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white'
  const outline = 'w-full min-h-[52px] rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900'
  return (
    <div className="mx-auto max-w-lg pb-28">
      {/* «Cancelar / Voltar» sempre visível ao deslizar (27 set). No editar,
          «Cancelar» em todos os passos e o nome do passo no meio (30 set). */}
      {edit
        ? (
          <div className={`sticky top-0 z-10 -mx-4 -mt-6 mb-1 bg-white px-4 ${scrolled ? 'border-b border-line' : ''}`} style={{ paddingTop: 'var(--safe-top, env(safe-area-inset-top))' }}>
            <div className="grid h-16 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-3">
              <button type="button" onClick={cancelEdit} aria-label={t('common.back')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-ink-900 shadow-card">
                <ChevronLeft size={22} />
              </button>
              <p className={`min-w-0 truncate text-center text-base font-extrabold text-ink-900 transition-opacity duration-fast ${scrolled ? 'opacity-100' : 'opacity-0'}`}>{title}</p>
              <span aria-hidden />
            </div>
          </div>
        )
        : <BackBar onBack={onBack} label={step === 1 ? t('steps.cancel') : t('common.back')} title={title} />}

      <h2 ref={titleRef} className="mt-2 text-3xl text-ink-900">{title}</h2>
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
          {!last && (
            <button type="button" onClick={onNext} disabled={nextDisabled || busy}
              className={`${black} disabled:opacity-40`}>
              {nextLabel || t('steps.next')}
            </button>
          )}
          {!last && nextDisabled && nextHint && <p className="text-center text-xs text-muted">{nextHint}</p>}
          <button type="button" onClick={edit.onSave} disabled={edit.saving || edit.saveDisabled}
            className={`${last ? black : outline} disabled:opacity-40`}>
            {edit.saving ? t('steps.saving') : t('steps.save_changes')}
          </button>
          {edit.saveDisabled && edit.saveHint && <p className="text-center text-xs text-muted">{edit.saveHint}</p>}
          {edit.danger && (
            <div className="pt-4">
              <button type="button" onClick={() => setAskingDanger(true)}
                className="w-full min-h-[52px] rounded-ctrl border-[1.5px] border-danger bg-white px-4 text-[15px] font-extrabold text-danger">
                {edit.danger.label}
              </button>
            </div>
          )}
        </div>
      ) : footer ? <div className="mt-8">{footer}</div> : (
        <div className="mt-8">
          <PrimaryButton onClick={onNext} disabled={nextDisabled || busy} className="w-full">
            {nextLabel || t('steps.next')}
          </PrimaryButton>
          {nextDisabled && nextHint && <p className="mt-1.5 text-center text-xs text-muted">{nextHint}</p>}
        </div>
      )}

      {edit?.danger && (
        <ConfirmSheet open={askingDanger} danger title={edit.danger.title} message={edit.danger.message}
          cancelLabel={edit.danger.cancelLabel} confirmLabel={edit.danger.confirmLabel}
          onConfirm={edit.danger.onConfirm} onClose={() => setAskingDanger(false)} errorOf={edit.danger.errorOf} />
      )}
      {edit && (
        <ConfirmSheet open={asking} outline title={t('steps.leave_title')}
          cancelLabel={t('steps.keep_editing')} confirmLabel={t('steps.leave_without_saving')}
          onConfirm={() => edit.onCancel()} onClose={() => setAsking(false)} />
      )}
    </div>
  )
}
