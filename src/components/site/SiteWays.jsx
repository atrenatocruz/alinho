// A página de entrada do site arrumado (design-handoff/2026-10-14-site-
// arrumado, computador/entrada.html; aprovado pelo Francisco a 17 out). No
// telemóvel, a mesma arrumação do computador, empilhada (UX, 18 out).
//
// Os cartões são os da app de hoje (R1), desenhados aqui à mão com a conta de
// exemplo (Maré Alta, Serra Azul) e «Imagem ilustrativa» — nunca uma conta
// nem um clube reais (PRODUCT.md).
import { Trans, useTranslation } from 'react-i18next'

// As cores de cada tipo, como na app (o cartão do R1 e o fundo claro).
const KIND = {
  mix: { strong: '#1D4ED8', light: '#EEF3FF' },
  tournament: { strong: '#5B21B6', light: '#F3EEFF' },
  friends: { strong: '#374151', light: '#EEF0F3' },
}

export const SITE_EYEBROW = 'font-mono text-[12px] font-medium uppercase tracking-[.12em] sm:text-[13px]'
export const SITE_H2 = 'font-display text-[34px] font-black leading-[1.05] tracking-[-.03em] text-ink-900 [text-wrap:balance] lg:text-[52px]'
export const SITE_LEAD = 'mt-4 max-w-[34ch] text-[17px] leading-[1.5] text-[#2A2E35] lg:text-[21px]'
export const SITE_ILL = 'mt-3 text-center text-[12px] font-medium text-[#7B818C]'

/** Um cartão do R1, parado: a faixa com a cor do tipo e o corpo branco. */
function SiteCard({ kind, kicker, time, aside, count, of, unit, club, clubInitials, title, chips, state, stateTone = 'warn', faces = [], more = 0, dashes = 0, cta }) {
  const c = KIND[kind]
  return (
    <div className="overflow-hidden rounded-[22px] bg-white text-left shadow-[0_1px_2px_rgba(17,17,17,.06),0_18px_34px_-22px_rgba(17,17,17,.35)]" aria-hidden="true">
      <div className="px-[18px] pb-4 pt-3.5 text-white" style={{ background: c.strong }}>
        <p className="font-mono text-[11px] font-medium uppercase tracking-[.1em]">{kicker}</p>
        <div className="mt-2.5 flex items-end justify-between">
          <span className="font-display text-[38px] font-extrabold leading-none tracking-[-.03em]">
            {time}<small className="ml-2 font-display text-[15px] font-medium tracking-normal opacity-85">{aside}</small>
          </span>
          <span className="text-right font-display text-[12.5px] font-medium leading-[1.1]">
            <b className="text-[26px] font-extrabold leading-none">{count}</b><small className="opacity-80">/{of}</small><br />{unit}
          </span>
        </div>
      </div>
      <div className="px-[18px] pb-[18px] pt-4">
        <p className="flex items-center gap-2 font-display text-[14px] font-bold text-[#2A2E35]">
          <span className="grid h-[26px] w-[26px] place-items-center rounded-[28%] bg-ink-900 font-display text-[10px] font-extrabold text-lime-400">{clubInitials}</span>
          {club} ›
        </p>
        <p className="mt-2.5 font-display text-[20px] font-extrabold leading-[1.2] text-ink-900">{title}</p>
        <p className="mt-1 text-[14px] leading-[1.35] text-[#6B7079]">{chips}</p>
        <p className={`mt-3 flex items-center gap-[7px] font-display text-[14px] font-bold ${stateTone === 'ok' ? 'text-[#3F6212]' : 'text-[#C2410C]'}`}>
          <span className="h-2 w-2 rounded-full bg-current" />{state}
        </p>
        <div className="mt-3.5 flex items-center">
          <span className="flex">
            {faces.map((f, i) => (
              <span key={f} className="relative -mr-[9px] grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-[#1F2937] font-display text-[11px] font-bold text-white" style={{ zIndex: 10 - i }}>{f}</span>
            ))}
            {more > 0 && (
              <span className="relative -mr-[9px] grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-[#EEF0F3] font-display text-[11px] font-bold text-[#5B6068]" style={{ zIndex: 10 - faces.length }}>+{more}</span>
            )}
            {Array.from({ length: dashes }, (_, i) => (
              <span key={`d${i}`} className="relative -mr-[9px] h-8 w-8 rounded-full border-2 border-dashed border-[#C9CCD1] bg-white shadow-[0_0_0_2px_#fff]" style={{ zIndex: 5 - i }} />
            ))}
          </span>
          <span className="ml-auto whitespace-nowrap rounded-[14px] bg-lime-400 px-4 py-[13px] sm:px-[18px] font-display text-[15px] font-extrabold leading-none text-ink-900">{cta}</span>
        </div>
      </div>
    </div>
  )
}

function Way({ kind, eyebrow, title, text, children }) {
  const c = KIND[kind]
  return (
    <div className="flex flex-col rounded-[28px] px-4 pb-4 pt-7 sm:px-6 sm:pb-6 lg:px-7 lg:pb-[30px] lg:pt-[34px]" style={{ background: c.light }}>
      <p className={SITE_EYEBROW} style={{ color: c.strong }}>{eyebrow}</p>
      <h3 className="mt-3 font-display text-[24px] font-extrabold leading-[1.15] tracking-[-.015em] text-ink-900 lg:text-[26px]">{title}</h3>
      <p className="mb-6 mt-2.5 text-[16px] text-[#2A2E35] lg:min-h-[76px]">{text}</p>
      <div className="mt-auto">{children}</div>
    </div>
  )
}

/** «Três formas de jogar»: o mix, o torneio e os amigos, cada um na sua cor
 *  e com o cartão da app. No computador, lado a lado e alinhados em baixo. */
export function WaysSection() {
  const { t } = useTranslation()
  return (
    <section className="bg-white py-16 lg:py-[110px]">
      <div className="mx-auto max-w-[1200px] px-5 lg:px-10">
        <p className={`${SITE_EYEBROW} text-[#5B6068]`}>{t('landing.ways_eyebrow')}</p>
        <h2 className={`${SITE_H2} mt-3 max-w-[16ch]`}>{t('landing.ways_title')}</h2>
        <div className="mt-8 grid gap-4 lg:mt-[50px] lg:grid-cols-3 lg:gap-6">
          <Way kind="mix" eyebrow={t('landing.mix_eyebrow')} title={t('landing.way_mix_title')} text={t('landing.way_mix_text')}>
            <SiteCard kind="mix" kicker={t('landing.card_mix_kicker')} time="20:00" aside={t('landing.card_until', { time: '21:30' })}
              count={6} of={8} unit={t('landing.card_signed')} club="Maré Alta Padel" clubInitials="MA"
              title={t('landing.card_mix_title')} chips={t('landing.card_mix_chips')} state={t('landing.card_mix_state')}
              faces={['TL', 'AM', 'PL']} more={3} dashes={2} cta={t('landing.card_join')} />
          </Way>
          <Way kind="tournament" eyebrow={t('landing.tour_eyebrow')} title={t('landing.tour_title')} text={t('landing.way_tour_text')}>
            <SiteCard kind="tournament" kicker={t('landing.card_tour_kicker')} time="09:00" aside={t('landing.card_tour_days')}
              count={43} of={48} unit={t('landing.card_pairs')} club="Serra Azul Padel" clubInitials="SA"
              title={t('landing.card_tour_title')} chips={t('landing.card_tour_chips')} state={t('landing.card_tour_state')} stateTone="ok"
              dashes={5} cta={t('landing.card_tour_join')} />
          </Way>
          <Way kind="friends" eyebrow={t('landing.way_friends_eyebrow')} title={t('landing.way_friends_title')} text={t('landing.way_friends_text')}>
            <SiteCard kind="friends" kicker={t('landing.card_friends_kicker')} time="10:00" aside={t('landing.card_friends_day')}
              count={3} of={4} unit={t('landing.card_players')} club="Serra Azul Padel" clubInitials="SA"
              title={t('landing.card_friends_title')} chips={t('landing.card_friends_chips')} state={t('landing.card_friends_state')}
              faces={['RF', 'TL', 'PL']} dashes={1} cta={t('landing.card_friends_accept')} />
          </Way>
        </div>
        <p className={`${SITE_ILL} !text-left`}>{t('landing.illustrative')}</p>
      </div>
    </section>
  )
}

// A conversa do robô como é de verdade (o cartão do main desde 3 out): a
// lista numerada com os nomes completos e os pontos, «Faltam 2.» e as
// instruções; a resposta «In»; e o cartão outra vez, com o nome de quem
// entrou. Sem o «Confirmado no mix», que o robô não faz.
const PLAYERS = [['Tiago Lopes', 1240], ['Ana Moreira', 1190], ['Pedro Lima', 1210], ['Inês Rocha', 1150], ['Joana Silva', 1175], ['Duarte Pires', 1260]]
const Emo = ({ children }) => <span aria-hidden="true">{children}</span>

/** `help`: na Ajuda, o cartão traz o «Dúvidas? Escreve /help.» do robô e o
 *  segundo cartão vem inteiro (SPEC da Ajuda, 13 out). */
export function BotChat({ help = false }) {
  const { t } = useTranslation()
  const bubble = 'max-w-[88%] rounded-[14px] px-3 pb-[7px] pt-2.5 text-[14.5px] leading-[1.45] text-[#111] shadow-[0_1px_1px_rgba(0,0,0,.08)]'
  const who = <span className="mb-1.5 block font-display text-[13px] font-bold leading-none text-[#1FA855]">Alinho</span>
  const time = (v) => <small className="mt-[5px] block text-right text-[11px] font-medium text-[#8A8F96]">{v}</small>
  return (
    <div className={`grid gap-2.5 rounded-[28px] bg-[#EFE7DD] px-4 py-5 sm:px-5 ${help ? '' : 'lg:ml-auto lg:max-w-[470px]'}`} role="img" aria-label={t('landing.bot_chat_alt')}>
      <div className={`${bubble} justify-self-start bg-white`}>
        {who}
        <Emo>🎾</Emo> <b>Mix de Quinta</b><br />{t('landing.bot_mix_line')}<br />{t('landing.bot_mix_prize')}<br /><br />
        {PLAYERS.map(([n, p], i) => <span key={n}>{i + 1}. {n} ({p})<br /></span>)}<br />
        <Emo>⏳</Emo> {t('landing.bot_missing_two')}<br />
        <Emo>👉</Emo> <Trans i18nKey="landing.bot_reply_hint" components={{ b: <b /> }} />
        {help && <><br />{t('landing.bot_help_line')}</>}
        {time('18:02')}
      </div>
      <div className={`${bubble} justify-self-end bg-[#D9FDD3]`}>In{time('18:04 ✓✓')}</div>
      <div className={`${bubble} justify-self-start bg-white`}>
        {who}
        {help ? (
          <>
            <Emo>🎾</Emo> <b>Mix de Quinta</b><br />{t('landing.bot_mix_line')}<br />{t('landing.bot_mix_prize')}<br /><br />
            {PLAYERS.map(([n, p], i) => <span key={n}>{i + 1}. {n} ({p})<br /></span>)}
            7. <b>Rita Figueira (973)</b><br /><br />
            <Emo>⏳</Emo> {t('landing.bot_missing_one')}<br />
            <Emo>👉</Emo> <Trans i18nKey="landing.bot_reply_hint" components={{ b: <b /> }} /><br />{t('landing.bot_help_line')}
          </>
        ) : (
          <>
            <Emo>🎾</Emo> <b>Mix de Quinta</b> · {t('landing.bot_mix_line').split(' · ').slice(0, 2).join(' · ')}<br />…<br />
            6. Duarte Pires (1260)<br />7. <b>Rita Figueira (973)</b><br /><br />
            <Emo>⏳</Emo> {t('landing.bot_missing_one')}
          </>
        )}
        {time('18:04')}
      </div>
    </div>
  )
}

/** O «In» do WhatsApp: o texto e os três pontos de um lado, a conversa do
 *  outro (no telemóvel, por baixo, a toda a largura). */
export function BotSection() {
  const { t } = useTranslation()
  const feats = [['in'], ['pair'], ['list']]
  return (
    <section className="bg-[#EEF3FF] py-16 lg:py-[110px]">
      <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-5 lg:grid-cols-2 lg:gap-20 lg:px-10">
        <div>
          <p className={`${SITE_EYEBROW} text-[#1D4ED8]`}>{t('landing.bot_eyebrow')}</p>
          <h2 className={`${SITE_H2} mt-3`}>{t('landing.mix_title')}</h2>
          <p className={SITE_LEAD}>{t('landing.mix_text')}</p>
          <div className="mt-8 grid gap-[22px] lg:mt-[34px]">
            {feats.map(([k]) => (
              <div key={k}>
                <h4 className="font-display text-[18px] font-extrabold leading-[1.25] text-ink-900 lg:text-[19px]">{t(`landing.bot_${k}_title`)}</h4>
                <p className="mt-1.5 max-w-[46ch] text-[16px] text-[#5B6068]">{t(`landing.bot_${k}_text`)}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <BotChat />
          <p className={`${SITE_ILL} lg:ml-auto lg:max-w-[470px]`}>{t('landing.illustrative')}</p>
        </div>
      </div>
    </section>
  )
}
