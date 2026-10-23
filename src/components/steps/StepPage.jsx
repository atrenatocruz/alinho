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
//   onNext, nextLabel = «Seguinte», nextDisabled, nextHint (o que falta)
//   nextMissingField — opcional: o id do campo em falta (ou do bloco à volta
//               dele). Francisco, 11 out: «Seguinte» já não fica só apagado
//               sem dizer nada — com o que falta (nextHint), carregar leva ao
//               campo, marca-o a vermelho e diz o que falta por baixo dele
//               (<StepMissingNote field="…" /> logo a seguir ao campo). Sem
//               campo, a frase aparece a vermelho por cima do botão.
//               «Seguinte» (e «Voltar») abrem sempre o passo novo no topo.
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
//               extra = { …o mesmo } — uma ação em contorno por cima do
//               destrutivo (ex.: «Voltar a rascunho», Francisco 6 out), com a
//               pergunta de vermelho cheio (danger). Com `disabled`, fica à
//               vista e apagado, com `hint` (a razão) por baixo. `danger: false` pergunta
//               a preto (quando ninguém sai prejudicado).
//
// Espaço da versão final (26 set): título → nome/barra 24 px, barra → 1.ª
// pergunta 24 px, entre perguntas 24 px, rótulo → campo 8 px (o mb-2 do
// rótulo), último campo → botão 32 px. Nada fica tapado pelo menu de baixo
// (pb-28, pedido do Bugs e da designer).
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackBar, ConfirmSheet } from '../ui'
import { ChevronLeft } from 'lucide-react'

const MissingContext = createContext(null)

/** O que falta, por baixo do campo (no estilo de erro da app), só depois de
 *  se carregar em «Seguinte» com esse campo em falta. */
export function StepMissingNote({ field }) {
  const c = useContext(MissingContext)
  if (!c?.shown || c.field !== field || !c.message) return null
  return <p role="alert" className="mt-2 rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{c.message}</p>
}

const clearMarks = () => {
  if (typeof document === 'undefined') return
  document.querySelectorAll('[data-step-missing]').forEach((el) => { delete el.dataset.stepMissing })
}

export default function StepPage({
  title, subtitle = null, step, total, stepLabel, onBack, top = null, children,
  onNext, nextLabel, nextDisabled = false, nextHint = null, nextMissingField = null, footer = null, error = '', busy = false, edit = null,
}) {
  const { t } = useTranslation()
  // «Seguinte» com alguma coisa em falta: mostra o quê, e onde.
  const [missingShown, setMissingShown] = useState(false)
  const [missingAtField, setMissingAtField] = useState(false)
  const canExplain = nextDisabled && !!nextHint
  const tryNext = () => {
    if (!nextDisabled) { onNext?.(); return }
    setMissingShown(true)
    clearMarks()
    const el = nextMissingField ? document.getElementById(nextMissingField) : null
    setMissingAtField(!!el)
    if (el) {
      el.dataset.stepMissing = 'true'
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      const focusable = el.matches('input, select, textarea') ? el : el.querySelector('input, select, textarea, button')
      focusable?.focus?.({ preventScroll: true })
    }
  }
  useEffect(() => { if (!nextDisabled) { setMissingShown(false); clearMarks() } }, [nextDisabled])
  useEffect(() => () => clearMarks(), [])
  // O passo novo abre no topo (Francisco, 11 out: «abre a meio»). Quem
  // desliza é o <main> da app, não a janela.
  const firstStep = useRef(true)
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return }
    setMissingShown(false)
    clearMarks()
    document.querySelector('main')?.scrollTo?.({ top: 0 })
    window.scrollTo?.(0, 0)
  }, [step])
  const stepped = total > 1
  const [asking, setAsking] = useState(false)
  const [askingDanger, setAskingDanger] = useState(false)
  const [askingExtra, setAskingExtra] = useState(false)
  // Sem a barra de baixo enquanto se cria ou edita por passos (30 set).
  useEffect(() => {
    document.body.dataset.steps = '1'
    return () => { delete document.body.dataset.steps }
  }, [])
  const cancelEdit = () => (edit?.dirty ? setAsking(true) : edit.onCancel())
  const last = !stepped || step >= total
  // A faixa dos botões, presa em baixo em todos os passos (criar e editar; UX,
  // 18 out): o fundo da página, sem transparência, 12 px em cima e a margem
  // segura em baixo. Fica no fim do conteúdo, por isso a última linha sobe
  // sempre acima dela.
  const bar = 'sticky bottom-0 z-10 -mx-4 mt-auto bg-ground px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)]'
  const black = 'w-full min-h-[52px] rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white'
  const outline = 'w-full min-h-[52px] rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900'
  const missingBox = missingShown && canExplain && !missingAtField && (
    <p role="alert" className="mb-2.5 rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{nextHint}</p>
  )
  return (
    <MissingContext.Provider value={{ shown: missingShown && canExplain, field: nextMissingField, message: nextHint }}>
    {/* A coluna ocupa o ecrã todo, para a faixa dos botões ficar sempre no
        fundo, também com pouco conteúdo (QA, 19 out: ficavam 112 px vazios). */}
    <div className="mx-auto flex min-h-[calc(100dvh-24px)] max-w-lg flex-col">
      {/* «Cancelar / Voltar» sempre visível ao deslizar (27 set). No editar,
          «Cancelar» em todos os passos e o nome do passo no meio (30 set). */}
      {/* Editar usa a mesma barra de vidro dos outros ecrãs (Renato, 16 out:
          a faixa branca própria não batia com o resto). */}
      {edit
        ? <BackBar onBack={cancelEdit} label={t('common.back')} title={title} />
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
        <p role="alert" className="mt-6 rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>
      )}

      <div className="h-8 shrink-0" aria-hidden="true" />
      {edit ? (
        // Botões do Editar (SPEC 2026-10-18-editar-botoes, Francisco 18 out):
        // presos em baixo e empilhados — «Seguinte» a preto, «Guardar
        // alterações» em contorno; no último passo só «Guardar», a preto.
        // O «Voltar a rascunho» e o «Eliminar» saíram para a folha «Editar e
        // mais opções» de cada evento; o `extra`/`danger` só fica para quem
        // ainda os passa (o torneio, até o Dev 1 os mudar).
        <div className={`${bar} space-y-2.5`}>
          {!last && missingBox}
          {!last && (
            <button type="button" onClick={tryNext} disabled={(nextDisabled && !canExplain) || busy}
              className={`${black} disabled:opacity-40`}>
              {nextLabel || t('steps.next')}
            </button>
          )}
          <button type="button" onClick={edit.onSave} disabled={edit.saving || edit.saveDisabled}
            className={`${last ? black : outline} disabled:opacity-40`}>
            {edit.saving ? t('steps.saving') : t('steps.save_changes')}
          </button>
          {edit.saveDisabled && edit.saveHint && <p className="text-center text-xs text-muted">{edit.saveHint}</p>}
          {/* As saídas juntas, longe do guardar (designer, 6 out), uma por
              baixo da outra a toda a largura — lado a lado não (Francisco). */}
          {(edit.extra || edit.danger) && (
            <div className="space-y-2.5 pt-4">
              {edit.extra && (
                <div className="space-y-1.5">
                  <button type="button" onClick={() => setAskingExtra(true)} disabled={!!edit.extra.disabled}
                    className="w-full min-h-[52px] rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
                    {edit.extra.label}
                  </button>
                  {edit.extra.disabled && edit.extra.hint && <p className="text-center text-xs text-muted">{edit.extra.hint}</p>}
                </div>
              )}
              {edit.danger && (
                <button type="button" onClick={() => setAskingDanger(true)}
                  className="w-full min-h-[52px] rounded-ctrl border-[1.5px] border-danger bg-white px-4 text-[15px] font-extrabold text-danger">
                  {edit.danger.label}
                </button>
              )}
            </div>
          )}
        </div>
      ) : footer ? <div className={bar}>{footer}</div> : (
        <div className={bar}>
          {missingBox}
          {/* A preto, como os outros «Seguinte» dos criar (era lima; Bugs, 18 out). */}
          <button type="button" onClick={tryNext} disabled={(nextDisabled && !canExplain) || busy}
            className={`press ${black} disabled:opacity-40`}>
            {nextLabel || t('steps.next')}
          </button>
        </div>
      )}

      {edit?.extra && (
        <ConfirmSheet open={askingExtra} danger={edit.extra.danger ?? true} title={edit.extra.title} message={edit.extra.message}
          cancelLabel={edit.extra.cancelLabel} confirmLabel={edit.extra.confirmLabel}
          onConfirm={edit.extra.onConfirm} onClose={() => setAskingExtra(false)} errorOf={edit.extra.errorOf} />
      )}
      {edit?.danger && (
        <ConfirmSheet open={askingDanger} danger title={edit.danger.title} message={edit.danger.message}
          cancelLabel={edit.danger.cancelLabel} confirmLabel={edit.danger.confirmLabel}
          onConfirm={edit.danger.onConfirm} onClose={() => setAskingDanger(false)} errorOf={edit.danger.errorOf} />
      )}
      {edit && (
        <ConfirmSheet open={asking} title={t('steps.leave_title')}
          cancelLabel={t('steps.keep_editing')} confirmLabel={t('steps.leave_without_saving')}
          onConfirm={() => edit.onCancel()} onClose={() => setAsking(false)} />
      )}
    </div>
    </MissingContext.Provider>
  )
}
