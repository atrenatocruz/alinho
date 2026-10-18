import { useEffect, useState } from 'react'
import { SiteHeader, SiteFooter, usePageTop } from '../components/site/SiteChrome'
import { useTranslation, Trans } from 'react-i18next'
import { Users, Calendar, Trophy, Settings, TrendingUp, Shield, MessageCircle, ChevronDown, ClipboardList } from 'lucide-react'
import { XP_TIERS, formatXp } from '../lib/xp'

const FAQ_COUNT = 6

/* FAQ (SEO, 29 set): perguntas em linguagem simples, com FAQPage em JSON-LD,
   para os resumos do Google terem de onde citar. Uma fonte só — as chaves
   instructions.faq_q1..6 / faq_a1..6 — para a página e o JSON-LD dizerem o
   mesmo. O <script> entra e sai com a página. */
function useFaqJsonLd(t) {
  useEffect(() => {
    const el = document.createElement('script')
    el.type = 'application/ld+json'
    el.id = 'faq-jsonld'
    el.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: Array.from({ length: FAQ_COUNT }, (_, i) => ({
        '@type': 'Question',
        name: t(`instructions.faq_q${i + 1}`),
        acceptedAnswer: { '@type': 'Answer', text: t(`instructions.faq_a${i + 1}`) },
      })),
    })
    document.head.appendChild(el)
    return () => el.remove()
  }, [t])
}

/* «Como usar o robô do WhatsApp» (/instrucoes#whatsapp, 1 out): texto do
   Marketing aprovado pelo Francisco e pelo Renato. **assim** = o que se
   escreve no WhatsApp, a negrito. */
const WA_KEYS = ['join', 'leave', 'several', 'pair', 'pair_leave', 'full', 'list', 'help']
const boldWa = (text) => text.split('**').map((part, i) => (i % 2 ? <b key={i} className="font-extrabold text-ink-900">{part}</b> : part))

// O design da app (Renato, 17 out): cartões brancos sobre o cinzento, títulos
// pequenos em mono por cima de cada bloco, ícones em quadrado cinzento.
const CARD = 'rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]'
const KICKER = 'mb-2 mt-7 px-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted'
const ICON = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-ctrl bg-surface text-ink-700'

/* Cada pergunta fechada numa linha, com ⌄; a resposta abre ao tocar. Só a
   primeira vem aberta (designer, 1 out: regra das explicações recolhidas). */
function Question({ q, a, first }) {
  const [open, setOpen] = useState(first)
  return (
    <div className="border-t border-line px-4 first:border-t-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex min-h-[52px] w-full items-center justify-between gap-3 py-2 text-left text-[15px] font-extrabold text-ink-900">
        {q} <ChevronDown size={18} className={`shrink-0 text-ink-500 transition-transform duration-fast ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pb-3.5 text-sm leading-relaxed text-ink-700">{a}</div>}
    </div>
  )
}

function Step({ n, children }) {
  return (
    <li className="flex gap-3.5 border-t border-line px-4 py-3.5 first:border-t-0">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-900 font-display text-sm font-extrabold text-white tabular-nums">{n}</span>
      <div className="min-w-0 pt-0.5 text-sm leading-relaxed text-ink-700 [&_strong]:font-extrabold [&_strong]:text-ink-900">{children}</div>
    </li>
  )
}

const SECTIONS = [
  ['comecar', 'help.nav_start'],
  ['ranking', 'help.nav_ranking'],
  ['xp', 'help.nav_xp'],
  ['organizar', 'help.nav_organize'],
  ['whatsapp', 'help.nav_whatsapp'],
  ['faq', 'help.nav_faq'],
]

/** O conteúdo da ajuda — o mesmo na página pública (/instrucoes) e dentro da
 *  app (/ajuda, com o «‹» da app). */
export function HelpContent() {
  const { t } = useTranslation()
  useFaqJsonLd(t)
  // Vindo de um link com #ranking, #xp, #whatsapp…: a página desenha-se
  // depois do salto do navegador, por isso desce-se aqui.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!id) return undefined
    const tm = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 50)
    return () => clearTimeout(tm)
  }, [])
  // As perguntas frequentes são o último bloco: num ecrã alto não havia página
  // por baixo para o título subir até à barra (Francisco, 8 out). Só quando se
  // chega pelo #faq, um espaço por baixo deixa-o subir.
  const [faqRoom] = useState(() => window.location.hash === '#faq')
  const jump = (id) => (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); window.history.replaceState(null, '', `#${id}`) }

  return (
    <div>
      <p className="text-sm text-muted">{t('instructions.subtitle')}</p>

      {/* Saltar para uma parte: links, não filtros — a página é a mesma. */}
      <nav aria-label={t('help.nav_aria')} className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar">
        {SECTIONS.map(([id, key]) => (
          <a key={id} href={`#${id}`} onClick={jump(id)}
            className="inline-flex min-h-[40px] shrink-0 items-center rounded-full border border-line bg-white px-3.5 text-sm font-extrabold text-ink-700">
            {t(key)}
          </a>
        ))}
      </nav>

      <p id="comecar" className={`${KICKER} scroll-mt-24`}>{t('help.section_start')}</p>
      <ol className={CARD}>
        <Step n={1}>{t('instructions.step_open_app')}</Step>
        <Step n={2}><Trans i18nKey="instructions.step_create_account_details">Clica em <strong>Criar Conta</strong>: preenche o teu nome, email, data de nascimento, género e cria uma password.</Trans></Step>
        <Step n={3}><Trans i18nKey="instructions.step_create_account">Clica em <strong>Criar conta</strong> — e estás dentro! Guarda bem a tua password.</Trans></Step>
        <Step n={4}>{t('instructions.step_games_list')}</Step>
        <Step n={5}>
          <Trans i18nKey="instructions.step_join_game">Para entrares num jogo, clica em <strong>Quero jogar</strong>.</Trans>
          <ul className="mt-1.5 space-y-1 text-muted">
            <li>• <Trans i18nKey="instructions.join_with_partner">Se tens parceiro: escolhe <strong>Entrar com parceiro</strong> e confirma o nome.</Trans></li>
            <li>• <Trans i18nKey="instructions.join_alone">Se não tens: escolhe <strong>Entrar sozinho</strong> — o sistema tenta arranjar parceiro.</Trans></li>
          </ul>
        </Step>
        <Step n={6}><Trans i18nKey="instructions.step_court_capacity">Cada mix tem <strong>campos × 4 jogadores</strong> (ex.: 2 campos = 8 jogadores). Quando enche, verás{' '}<strong>Mix fechado — campo reservado</strong> e deixa de aceitar inscrições.</Trans></Step>
        <Step n={7}><Trans i18nKey="instructions.step_profile_side">No teu <strong>Perfil</strong>, define o teu <strong>lado preferido</strong>{' '}(Esquerda, Direita ou Ambos) — é usado para formar as duplas: quem entra sozinho é emparelhado juntando um jogador de esquerda com um de direita.</Trans></Step>
        <Step n={8}>
          <Trans i18nKey="instructions.step_admin_start">Quando o mix está cheio, o admin clica em <strong>Começar o jogo</strong>: as duplas são formadas, as rondas calculadas (tempo do court ÷ tempo de jogo) e os jogos sorteados pelos campos conforme o formato.</Trans>
          <ul className="mt-1.5 space-y-1 text-muted">
            <li>• <Trans i18nKey="instructions.rule_sobe_desce"><strong>Sobe e desce:</strong> quem ganha sobe um campo, quem perde desce. Vence o mix a dupla que ganhar no campo 1 na última ronda.</Trans></li>
            <li>• <Trans i18nKey="instructions.rule_todos_contra_todos"><strong>Todos contra todos:</strong> cada dupla joga contra todas as outras; se sobrarem rondas, há fase eliminatória (meias-finais / final).</Trans></li>
          </ul>
        </Step>
        <Step n={9}><Trans i18nKey="instructions.step_results">Durante o mix, o admin regista o resultado de <strong>cada jogo</strong> (não há empates). No sobe e desce só se avança de ronda com os resultados todos submetidos. No fim, o admin clica em <strong>Finalizar jogo</strong> e o ranking atualiza: vitórias/derrotas de jogos por jogador e <strong>+1 vitória de mix</strong>{' '}para a dupla vencedora.</Trans></Step>
      </ol>

      <div className={`${CARD} mt-3 flex gap-3 p-4`}>
        <span className={ICON}><MessageCircle size={18} /></span>
        <p className="min-w-0 text-sm leading-relaxed text-ink-700 [&_strong]:font-extrabold [&_strong]:text-ink-900">
          <Trans i18nKey="instructions.tip"><strong>💡 Dica:</strong> Se algo não funcionar: faz um print e envia por WhatsApp a um dos fundadores. Guarda o link do site para aceder facilmente.</Trans>
        </p>
      </div>

      <p className={KICKER}>{t('help.section_essentials')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          [Calendar, 'instructions.card_view_games_title', t('instructions.card_view_games_body')],
          [Users, 'instructions.card_join_games_title', t('instructions.card_join_games_body')],
          [Trophy, 'instructions.card_rankings_title', <Trans key="r" i18nKey="instructions.card_rankings_body">O ranking mostra, por jogador: <strong>mixes ganhos</strong> (vitórias de mix) e{' '}<strong>vitórias/derrotas de jogos</strong> (cada jogo individual dentro dos mixes).</Trans>],
          [Settings, 'instructions.card_edit_profile_title', t('instructions.card_edit_profile_body')],
        ].map(([Icon, titleKey, body]) => (
          <div key={titleKey} className={`${CARD} flex gap-3 p-4`}>
            <span className={ICON}><Icon size={18} /></span>
            <div className="min-w-0">
              <h3 className="font-display text-base font-extrabold text-ink-900">{t(titleKey)}</h3>
              <p className="mt-0.5 text-sm leading-relaxed text-muted [&_strong]:font-extrabold [&_strong]:text-ink-900">{body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Como funciona o ranking (Elo) — explicação qualitativa, de propósito
          sem os parâmetros da fórmula (K, divisor, etc.): são afináveis pela
          equipa e publicá-los convidava a rule-lawyering. */}
      <p id="ranking" className={`${KICKER} scroll-mt-24`}>{t('help.nav_ranking')}</p>
      <section className={`${CARD} p-4`}>
        <div className="flex items-center gap-3">
          <span className={ICON}><TrendingUp size={18} /></span>
          <h3 className="font-display text-lg font-extrabold text-ink-900">{t('instructions.elo_title')}</h3>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-700">{t('instructions.elo_intro')}</p>
        <ul className="mt-3 space-y-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-700">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-900" />
              {t(`instructions.elo_b${i}`)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">{t('instructions.elo_note')}</p>
      </section>

      {/* XP e escudos — aqui SIM com a tabela completa: um sistema de
          incentivo só funciona com as regras à vista. Fonte única: XP_TIERS. */}
      <p id="xp" className={`${KICKER} scroll-mt-24`}>{t('help.nav_xp')}</p>
      <section className={`${CARD} p-4`}>
        <div className="flex items-center gap-3">
          <span className={ICON}><Shield size={18} /></span>
          <h3 className="font-display text-lg font-extrabold text-ink-900">{t('instructions.xp_title')}</h3>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-700">{t('instructions.xp_intro')}</p>
        <ul className="mt-3 space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-700">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-900" />
              {t(`instructions.xp_v${i}`)}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm font-extrabold text-ink-900">{t('instructions.xp_shields_intro')}</p>
        <div className="mt-2 overflow-hidden rounded-ctrl border border-line">
          {[...XP_TIERS].reverse().map((tier) => (
            <div key={tier.key} className="flex min-h-[44px] items-center gap-3 border-t border-line px-3 text-sm first:border-t-0">
              <span className="w-6 font-mono text-xs text-muted tabular-nums">{tier.level}</span>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tier.dotClass}`} />
              <span className="flex-1 font-extrabold text-ink-900">{t(tier.labelKey)}</span>
              <span className="text-muted tabular-nums">{formatXp(tier.min)} XP</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{t('instructions.xp_glow')}</p>
      </section>

      <p id="organizar" className={`${KICKER} scroll-mt-24`}>{t('help.nav_organize')}</p>
      <section className={`${CARD} p-4`}>
        <div className="flex items-center gap-3">
          <span className={ICON}><ClipboardList size={18} /></span>
          <h3 className="font-display text-lg font-extrabold text-ink-900">{t('instructions.admin_guide_title')}</h3>
        </div>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-700 [&_strong]:font-extrabold [&_strong]:text-ink-900">
          <p><Trans i18nKey="instructions.admin_create_mix"><strong>Para criar um mix:</strong> "Criar novo jogo" → define título, data, local,{' '}<strong>nº de campos</strong> (jogadores = campos × 4), <strong>tempo do court</strong>,{' '}<strong>tempo de jogo</strong> (rondas = court ÷ jogo) e o <strong>formato</strong>{' '}(sobe e desce ou todos contra todos).</Trans></p>
          <p><Trans i18nKey="instructions.admin_start_mix"><strong>Para arrancar o mix:</strong> quando estiver cheio, abre o jogo e clica{' '}<strong>Começar o jogo</strong> — as duplas e o sorteio são automáticos.</Trans></p>
          <p><Trans i18nKey="instructions.admin_during_mix"><strong>Durante o mix:</strong> regista o resultado de cada jogo, avança as rondas e no fim clica <strong>Finalizar jogo</strong> para atualizar o ranking.</Trans></p>
          <p><Trans i18nKey="instructions.admin_manage_members"><strong>Para gerir membros:</strong> Acede ao painel Admin para ver todos os jogadores e promover novos admins.</Trans></p>
        </div>
      </section>

      <p id="whatsapp" className={`${KICKER} scroll-mt-24`}>{t('help.nav_whatsapp')}</p>
      <section className={CARD}>
        <div className="flex gap-3 p-4 pb-2">
          <span className={ICON}><MessageCircle size={18} /></span>
          <div className="min-w-0">
            <h3 className="font-display text-lg font-extrabold text-ink-900">{t('instructions.wa_title')}</h3>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">{t('instructions.wa_intro')}</p>
          </div>
        </div>
        <div className="border-t border-line">
          {WA_KEYS.map((k, i) => (
            <Question key={k} first={i === 0} q={t(`instructions.wa_q_${k}`)} a={boldWa(t(`instructions.wa_a_${k}`))} />
          ))}
        </div>
      </section>

      <p id="faq" className={`${KICKER} scroll-mt-24`}>{t('instructions.faq_title')}</p>
      <section className={CARD}>
        {Array.from({ length: FAQ_COUNT }, (_, i) => (
          <Question key={i} first={i === 0} q={t(`instructions.faq_q${i + 1}`)} a={t(`instructions.faq_a${i + 1}`)} />
        ))}
      </section>

      <p className="mt-6 px-0.5 text-center text-sm text-muted">{t('instructions.contact_help')}</p>
      {faqRoom && <div aria-hidden="true" className="h-[calc(100dvh-8rem)]" />}
    </div>
  )
}

/** A página pública (/instrucoes): para quem ainda não tem conta (Login,
 *  página inicial, Google). Mesmo conteúdo, com um topo próprio. */
export default function Instructions() {
  usePageTop()
  const { t } = useTranslation()
  // O cabeçalho e o rodapé comuns do site (site arrumado, 17 out): sai a
  // barra própria com «←» e o título. A Ajuda nova vem a seguir.
  return (
    <div className="min-h-screen bg-ground">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-6">
        <h1 className="mb-4 font-display text-[32px] font-extrabold leading-tight text-ink-900">{t('instructions.title')}</h1>
        <HelpContent />
      </main>
      <SiteFooter />
    </div>
  )
}
