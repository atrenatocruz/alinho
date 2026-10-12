import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'

/* «Partilhar em nome de quem?» (design-handoff/2026-10-12-partilhar-em-nome-
   de-quem, aprovado pelo Francisco a 12 out). Só para quem organizou e também
   jogou: antes do «Juntar uma foto?», escolhe entre o cartão com o seu lugar
   em destaque e o cartão do clube, só com os vencedores. Tocar numa opção
   segue logo; tocar fora fecha. Não se guarda: pergunta-se sempre. */

// O cartão em miniatura à esquerda de cada opção: com a linha a lima (em teu
// nome) ou só as linhas cinzentas (em nome do clube).
function MiniCard({ mine }) {
  return (
    <span aria-hidden="true" className="flex h-[60px] w-[42px] shrink-0 flex-col gap-[5px] rounded-[8px] bg-ink-900 px-[6px] py-[7px]">
      <span className={`h-[5px] w-[22px] rounded-full ${mine ? 'bg-lime-400' : 'bg-white'}`} />
      <span className="h-[6px] rounded-[3px] bg-white/25" />
      <span className={`h-[6px] rounded-[3px] ${mine ? 'border border-lime-400' : 'bg-white/25'}`} />
      <span className="h-[6px] rounded-[3px] bg-white/25" />
      {mine && <span className="mt-auto h-[4px] w-[20px] rounded-full border border-white/40" />}
    </span>
  )
}

function Option({ mine, title, line, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="press flex w-full items-center gap-3.5 rounded-card border-[1.5px] border-line bg-white px-4 py-3.5 text-left">
      <MiniCard mine={mine} />
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-extrabold leading-tight text-ink-900">{title}</span>
        <span className="mt-1 block text-[14px] leading-snug text-ink-500">{line}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-ink-500" />
    </button>
  )
}

/** kind: 'mix' | 'americano'. place/won/played: o lugar e as vitórias de
 *  quem partilha; orgName: o clube ou grupo. */
export default function ShareAsSheet({ kind = 'mix', place, won = 0, played = 0, orgName, onPick, onClose }) {
  const { t } = useTranslation()
  const mineLine = won > 0
    ? t('shareas.mine_line_record', { place, won, played })
    : t('shareas.mine_line', { place })
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="share-as-title"
        className="w-full max-w-md rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-lift sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-ink-200" />
        <p id="share-as-title" className="text-[20px] font-extrabold leading-tight text-ink-900">{t('shareas.title')}</p>
        <p className="mt-2 text-[15px] leading-snug text-ink-500">{t(`shareas.body_${kind}`)}</p>
        <div className="mt-4 space-y-2.5">
          <Option mine title={t('shareas.mine')} line={mineLine} onClick={() => onPick('me')} />
          <Option title={t('shareas.club', { org: orgName })} line={t('shareas.club_line')} onClick={() => onPick('club')} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
