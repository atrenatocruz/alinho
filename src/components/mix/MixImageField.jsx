// «Imagem (opcional)» no criar e no editar do mix (Home do futuro, SPEC-3 —
// aprovado pelo Francisco a 9 out): igual ao «Cartaz (opcional)» do torneio,
// «Carregar imagem» e uma frase a dizer onde aparece. Com imagem, vê-se a
// imagem com o × para a tirar.
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, X } from 'lucide-react'
import { uploadMixImage } from '../../lib/mixImageStorage'
import { describeError } from '../../lib/errors'

export default function MixImageField({ value, onChange, organizationId }) {
  const { t } = useTranslation()
  const input = useRef(null)
  const [state, setState] = useState({ busy: false, error: '' })

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !organizationId) return
    setState({ busy: true, error: '' })
    try {
      onChange(await uploadMixImage(organizationId, file))
      setState({ busy: false, error: '' })
    } catch (err) {
      setState({ busy: false, error: describeError(t, err, 'mix.image_error') })
    }
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gray-700">{t('mix.image')}</p>
      {value ? (
        // A mesma faixa do cartão da Home (~88 px, cantos redondos): quem
        // organiza vê exatamente o corte que vai aparecer (UX, 10 out).
        <div className="relative overflow-hidden rounded-xl">
          <img src={value} alt={t('mix.image')} className="block h-[88px] w-full object-cover" />
          <button type="button" onClick={() => { onChange(null); setState({ busy: false, error: '' }) }}
            aria-label={t('mix.image_remove')}
            className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-ink-900/80 text-white">
            <X size={15} />
          </button>
        </div>
      ) : (
        <button type="button" disabled={state.busy || !organizationId} onClick={() => input.current?.click()}
          className="input-field flex items-center gap-2 text-left text-ink-500 disabled:opacity-60">
          <ImagePlus size={18} />
          {state.busy ? t('tournament.create.poster_uploading') : t('tournament.create.poster_pick')}
        </button>
      )}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={pick} />
      {!value && <p className="mt-1.5 text-sm text-muted">{t('mix.image_hint')}</p>}
      {state.error && <p className="mt-1 text-xs text-danger">{state.error}</p>}
    </div>
  )
}
