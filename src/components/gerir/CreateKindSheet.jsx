// «O que queres criar?» (R9 do redesign, design-handoff/2026-10-13-redesign/
// R9-gerir.md, aprovado pelo Francisco a 13 out). Um só botão «＋ Criar» no
// Gerir abre esta folha: um cartão por tipo, na cor forte do tipo (R0) e com a
// imagem pequena do Alino, pela ordem da Home. Cada cartão abre o criar por
// passos de hoje (`onPick(tipo)`, o mesmo `abrirCriar` dos botões de antes).
// Só muda o sítio e o aspeto: o que cada plano deixa criar fica igual.
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { KIND_COLORS, KIND_HERO } from '../../lib/kindColors'

// O tipo do Gerir → a chave das cores e das imagens (R0).
const KIND_OF = { mix: 'mix', aberto: 'open', torneio: 'tournament', turma: 'lesson', amigos: 'friends' }
const LABEL = {
  mix: 'gerirclube.event_label_mix',
  aberto: 'gerirclube.create_kind_open',
  torneio: 'gerirclube.event_label_tournament',
  turma: 'gerirclube.event_label_series',
  amigos: 'gerirclube.create_kind_friends',
}

/** kinds: os tipos que este clube ou grupo pode criar, já pela ordem. */
export default function CreateKindSheet({ orgName, kinds, onPick, onClose }) {
  const { t } = useTranslation()
  return (
    // Como no protótipo (.sheetx): folha branca com a pega, o título grande
    // e «Fechar» em baixo — sem a cruz em cima.
    createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(10,12,20,.45)] animate-fade-in sm:items-center" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label={t('gerirclube.create_sheet_title')}
      className="max-h-[80%] w-full overflow-y-auto rounded-t-[24px] bg-white px-4 pt-2.5 animate-pop sm:max-w-[420px] sm:rounded-[24px]"
      style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}
      onClick={(e) => e.stopPropagation()}>
      <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#D1D5DB]" />
      <h3 className="font-display text-[20px] font-black leading-tight text-ink-900">{t('gerirclube.create_sheet_title')}</h3>
      <p className="mt-1 text-[13px] leading-normal text-ink-500">{t('gerirclube.create_sheet_sub', { name: orgName })}</p>
      <div className="mt-4 space-y-2.5">
        {kinds.map((tipo) => {
          const k = KIND_OF[tipo]
          return (
            <button key={tipo} type="button" onClick={() => onPick(tipo)}
              className="press flex min-h-[76px] w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left text-white"
              style={{ background: KIND_COLORS[k]?.strong }}>
              <span aria-hidden="true" className="h-12 w-14 shrink-0 overflow-hidden rounded-[10px] bg-black/15">
                {KIND_HERO[k] && <img src={KIND_HERO[k]} alt="" loading="lazy" className="h-full w-full object-cover object-[70%_25%]" />}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block font-display text-[15px] font-extrabold leading-tight">{t(LABEL[tipo])}</b>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-white/90">{t(`gerirclube.create_desc_${tipo}`)}</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-white/80" />
            </button>
          )
        })}
      </div>
      <button type="button" onClick={onClose}
        className="mt-4 flex min-h-[48px] w-full items-center justify-center rounded-ctrl border-[1.5px] border-line bg-white text-base font-extrabold text-ink-900">
        {t('ui.close')}
      </button>
    </div>
    </div>,
    document.body)
  )
}
