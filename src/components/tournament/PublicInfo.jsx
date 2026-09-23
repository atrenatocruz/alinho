import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Share2, Euro, Info } from 'lucide-react'
import { PrimaryButton } from '../ui'
import LocationOpenWith from '../LocationOpenWith'
import { whatsappShare } from '../../lib/partnerInvite'
import { formatWords, categoryWhen, slotsWords, tournamentUrl, shareMessage } from '../../lib/tournamentPublic'

/* O cartaz do torneio (Trello #363) — o que vê quem chega de fora, sem
   conta: categorias com dia, hora e vagas, o formato em linguagem de
   jogador, o que é preciso pagar, o mapa e quem organiza.

   Desenho: wireframes/torneio.html, «Quem chega de fora». A única coisa
   que falta a quem não tem conta é o botão de inscrever — que vive no
   SignupSlot, já com o caminho para criar conta. */

export default function PublicInfo({ tournament, categories = [] }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)

  const url = tournamentUrl(tournament, typeof window === 'undefined' ? '' : window.location.origin)
  const share = () => {
    const text = shareMessage(tournament, window.location.origin)
    if (navigator.share) { navigator.share({ title: tournament.name, text, url }).catch(() => {}) ; return }
    window.open(whatsappShare(text), '_blank')
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-widest text-ink-500">{t('tpublic.title')}</p>
        <button onClick={share} className="press flex items-center gap-1.5 text-sm font-extrabold text-ink-900">
          <Share2 size={16} /> {t('tpublic.share')}
        </button>
      </div>

      {/* O cartaz não vem aqui: desde 22 set mora no cartão do topo,
          por cima do nome do torneio (Dev 1). */}

      {/* Categorias: dia, hora e vagas — é o que decide se me inscrevo. */}
      <div className="space-y-1.5">
        {(open ? categories : categories.slice(0, 4)).map((c) => {
          const when = categoryWhen(c, i18n.language === 'en' ? 'en-GB' : 'pt-PT')
          const slots = slotsWords(c)
          const fmt = formatWords(c)
          return (
            <div key={c.id} className="rounded-ctrl bg-ink-50 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-extrabold text-ink-900 truncate">
                  {c.code} · {c.name}
                </p>
                {slots && (
                  <span className={`shrink-0 text-xs font-extrabold ${slots.key === 'tsignup.category_full' ? 'text-muted' : 'text-ok-700'}`}>
                    {t(slots.key, slots.values)}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted">
                {[
                  when && (typeof when === 'string' ? when : t('tpublic.when', when)),
                  t(fmt.key, fmt.values),
                  c.price_cents != null ? t('tsignup.price', { price: (c.price_cents / 100).toFixed(0) }) : null,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
          )
        })}
        {categories.length > 4 && (
          <button onClick={() => setOpen((v) => !v)} className="press text-sm font-extrabold text-ink-900 underline">
            {open ? t('tpublic.show_less') : t('tpublic.show_more', { count: categories.length - 4 })}
          </button>
        )}
      </div>

      {/* Pagamento e o que inclui — texto do organizador, tal como o escreveu. */}
      {(tournament.organizer_text || tournament.entry_fee_cents != null) && (
        <div className="flex gap-2 text-sm">
          <Euro size={16} className="mt-0.5 shrink-0 text-muted" />
          <p className="text-ink-900">
            {tournament.entry_fee_cents != null && (
              <b className="mr-1">{t('tsignup.price', { price: (tournament.entry_fee_cents / 100).toFixed(0) })}</b>
            )}
            <span className="text-muted">{tournament.organizer_text}</span>
          </p>
        </div>
      )}

      {/* Onde é, e quem organiza. */}
      {tournament.location && (
        <LocationOpenWith location={tournament.location} />
      )}
      {tournament.club_name && (
        <div className="flex gap-2 text-sm">
          <Info size={16} className="mt-0.5 shrink-0 text-muted" />
          <p className="text-muted">{t('tpublic.organiser', { club: tournament.club_name })}</p>
        </div>
      )}
    </div>
  )
}
