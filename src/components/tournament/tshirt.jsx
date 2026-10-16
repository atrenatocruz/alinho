// T-shirts no torneio (Francisco, 8 out: «sim aprovo, manda implementar»;
// SPEC design-handoff/2026-10-08-torneio-t-shirts). A t-shirt é do torneio
// inteiro — rules.tshirt = { mode: 'none' | 'gift' | 'sale', price_cents,
// sizes } — e cada jogador escolhe o tamanho na inscrição: player1_tshirt /
// player2_tshirt (Dev 3). «Não quero» é uma escolha e grava-se como 'none';
// sem escolha ainda, null.
import { useTranslation } from 'react-i18next'

export const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
export const NO_TSHIRT = 'none'

/** As regras de t-shirt de um torneio vindo da página: a get_tournament_page
 *  traz `tournament.tshirt` à parte (Dev 3); o editar traz `rules.tshirt`. */
export const shirtRulesOf = (tournament) => ({ tshirt: tournament?.tshirt ?? tournament?.rules?.tshirt ?? null })

/** O bloco do torneio, sempre com os três campos. */
export const tshirtOf = (rules) => ({ mode: 'none', price_cents: 0, sizes: TSHIRT_SIZES, ...(rules?.tshirt || {}) })

/** Com «Sem t-shirt», nada disto aparece em lado nenhum. */
export const tshirtOn = (rules) => ['gift', 'sale'].includes(rules?.tshirt?.mode)

/** Os tamanhos que há, pela ordem de sempre. */
export const sizesOf = (rules) => TSHIRT_SIZES.filter((s) => (tshirtOf(rules).sizes || []).includes(s))

/** Quantas t-shirts pedidas (os «Não quero» e os por escolher não contam). */
export const countRequested = (choices = []) => choices.filter((c) => c && c !== NO_TSHIRT).length

const euros = (cents, locale) => (Number(cents || 0) / 100).toLocaleString(locale, { maximumFractionDigits: 2 })

/** «12 €» ou «oferta» — o que vai a seguir a «A tua t-shirt ·». */
export function tshirtPriceLabel(rules, t, locale) {
  const ts = tshirtOf(rules)
  return ts.mode === 'gift' ? t('tshirt.gift_short') : t('tshirt.price_short', { price: euros(ts.price_cents, locale) })
}

/** O total da dupla, só com as t-shirts pedidas (SPEC, ponto 2):
 *  «25 € à dupla + 1 t-shirt 12 € = 37 €». Sem t-shirts à venda pedidas, null
 *  — fica a frase do preço de hoje. */
export function pairTotalLine(pairEuros, rules, choices, t, locale) {
  const ts = tshirtOf(rules)
  const n = countRequested(choices)
  if (ts.mode !== 'sale' || !n) return null
  const shirts = (Number(ts.price_cents || 0) * n) / 100
  return t('tshirt.pair_total', {
    pair: Number(pairEuros || 0).toLocaleString(locale),
    count: n,
    shirts: shirts.toLocaleString(locale, { maximumFractionDigits: 2 }),
    total: (Number(pairEuros || 0) + shirts).toLocaleString(locale, { maximumFractionDigits: 2 }),
  })
}

/** «Não quero · XS · S · M · L · XL · XXL», só com os tamanhos que há. Uma
 *  escolha de formulário: pastilhas soltas, a escolhida a preto (regra de 24
 *  set), embrulhadas em filas como no desenho. */
export function TshirtPicker({ rules, value, onChange, label, disabled = false }) {
  const { t } = useTranslation()
  const options = [NO_TSHIRT, ...sizesOf(rules)]
  return (
    <div role="group" aria-label={label} className="-my-0.5 flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value === o
        return (
          <button key={o} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(o)}
            className="inline-flex min-h-[44px] items-center disabled:opacity-50">
            <span className={`inline-flex min-h-[40px] min-w-[44px] items-center justify-center whitespace-nowrap rounded-full border px-3.5 text-sm font-extrabold transition-colors duration-fast ${
              on ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-700'
            }`}>
              {o === NO_TSHIRT ? t('tshirt.no_thanks') : o}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** O tamanho em pequeno: «L», «—» (não quer), «?» (ainda não escolheu). */
export const sizeMark = (size) => (size === NO_TSHIRT ? '—' : size || '?')

/** O bloco «T-shirt do torneio» do criar e do editar (SPEC, ponto 1). */
export function TshirtField({ rules, onChange, FieldLabel }) {
  const { t } = useTranslation()
  const ts = tshirtOf(rules)
  const set = (patch) => onChange({ ...ts, ...patch })
  const toggleSize = (s) => {
    const has = ts.sizes.includes(s)
    // Fica sempre pelo menos um: sem tamanhos não há o que escolher.
    if (has && ts.sizes.length === 1) return
    set({ sizes: has ? ts.sizes.filter((x) => x !== s) : TSHIRT_SIZES.filter((x) => x === s || ts.sizes.includes(x)) })
  }
  const modes = [
    { value: 'none', label: t('tshirt.mode_none') },
    { value: 'gift', label: t('tshirt.mode_gift') },
    { value: 'sale', label: t('tshirt.mode_sale') },
  ]
  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>{t('tshirt.title')}</FieldLabel>
        <div role="group" aria-label={t('tshirt.title')} className="-my-0.5 flex flex-wrap gap-2">
          {modes.map((m) => {
            const on = ts.mode === m.value
            return (
              <button key={m.value} type="button" aria-pressed={on} onClick={() => set({ mode: m.value })}
                className="inline-flex min-h-[44px] items-center">
                <span className={`inline-flex min-h-[40px] items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-extrabold transition-colors duration-fast ${
                  on ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-700'
                }`}>{m.label}</span>
              </button>
            )
          })}
        </div>
      </div>
      {ts.mode === 'sale' && (
        <div>
          <FieldLabel>{t('tshirt.price_label')}</FieldLabel>
          <input type="number" min="0" max="200" inputMode="decimal" className="input-field"
            value={ts.price_cents ? ts.price_cents / 100 : ''}
            onChange={(e) => set({ price_cents: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) })} />
          <p className="mt-1 text-xs text-ink-500">{t('tshirt.price_hint')}</p>
        </div>
      )}
      {ts.mode !== 'none' && (
        <div>
          <FieldLabel>{t('tshirt.sizes_label')}</FieldLabel>
          <div role="group" aria-label={t('tshirt.sizes_label')} className="-my-0.5 flex flex-wrap gap-2">
            {TSHIRT_SIZES.map((s) => {
              const on = ts.sizes.includes(s)
              return (
                <button key={s} type="button" aria-pressed={on} onClick={() => toggleSize(s)}
                  className="inline-flex min-h-[44px] items-center">
                  <span className={`inline-flex h-11 min-w-[44px] items-center justify-center rounded-full border px-2.5 text-sm font-extrabold transition-colors duration-fast ${
                    on ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-500'
                  }`}>{s}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-xs text-ink-500">{t('tshirt.sizes_hint')}</p>
        </div>
      )}
    </div>
  )
}
