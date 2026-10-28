/* ════════════════════════════════════════════════════════════════════════
   Conquistas — display puro.

   ("Achievements" à Steam/Xbox/Strava. O nome "troféus" está reservado
   para a futura estante real de troféus de torneio com prémios — ver
   migration_achievements_rename.sql.)

   A autoridade é o Postgres: o catálogo vive na tabela `achievements` (a
   UI lê-a para mostrar também os bloqueados) e a atribuição é 100%
   server-side (check_and_award_achievements). Aqui só existe o vestuário:
   ícone por conquista, cores por raridade (linguagem universal de gaming:
   cinza/azul/roxo/dourado) e ordenação de categorias.

   Nomes/descrições: locales `achievements.<key>_name` / `_desc`.
   Conquista nova = 1 bloco SQL no verificador + 1 linha no seed + ícone
   aqui (com fallback) + 2 chaves de tradução.
   ════════════════════════════════════════════════════════════════════════ */
import { localeOf } from './formatDate'
import {
  Rocket, Footprints, Coffee, Home, Milestone, Landmark, CalendarDays,
  CalendarCheck, CalendarClock, Moon, Sunrise, Sun, Megaphone, Flame,
  Medal, Crown, Sparkles, Repeat, Trophy, Cpu, TrendingUp, HeartHandshake,
  Route, Infinity as InfinityIcon, Target, ArrowUpRight, ChevronsUp,
  Star, Mountain, Swords, Shield, Award, Gem, Diamond, ThumbsUp, Heart,
  Smile, Key, Clock, Hourglass, Globe, Ticket,
  CalendarRange, CalendarHeart, Zap, Sunset, RotateCcw, Cake, MapPin,
  ArrowUpToLine, ArrowBigUpDash, CircleSlash2, Coins, Timer, LayoutGrid,
  BarChart3, ArrowUpDown, Users, UsersRound, Link, UserPlus, MessageCircle,
  Smartphone, Flag, ListOrdered, Layers, GraduationCap, BookOpen, Gift,
  Scale, Hash, Compass, Crosshair, Anchor, Egg, Dumbbell, Plane, Bell,
  Car, RotateCw, DoorOpen, Unlock,
} from 'lucide-react'

const ICONS = {
  primeira_bola: Rocket,
  areia_nos_tenis: Footprints,
  cliente_da_casa: Coffee,
  residente: Home,
  meio_cento: Milestone,
  centuriao_do_vidro: Landmark,
  semana_cheia: CalendarDays,
  mes_cheio: CalendarCheck,
  ritual_de_segunda: CalendarClock,
  coruja_do_padel: Moon,
  madrugador: Sunrise,
  fds_sagrado: Sun,
  primeiro_grito: Megaphone,
  mao_quente: Flame,
  dono_do_campo_1: Medal,
  dinastia: Crown,
  noite_perfeita: Sparkles,
  bis: Repeat,
  bandeja_de_prata: Trophy,
  maquina_de_pontos: Cpu,
  remontada: TrendingUp,
  entre_amigos: HeartHandshake,
  circuito_paralelo: Route,
  sempre_em_jogo: InfinityIcon,
  calibrado: Target,
  fora_da_areia: ArrowUpRight,
  subida_ao_vidro: ChevronsUp,
  zona_nobre: Star,
  ar_rarefeito: Mountain,
  gigante: Swords,
  primeiro_escudo: Shield,
  escudo_ouro: Award,
  escudo_esmeralda: Gem,
  escudo_diamante: Diamond,
  lenda_viva: Star,
  world_class: Crown,
  primeiro_aplauso: ThumbsUp,
  bom_de_balneario: Heart,
  querido_do_clube: Smile,
  idolo_da_bancada: Star,
  mvp_da_noite: Trophy,
  fair_play: HeartHandshake,
  socio_fundador: Key,
  meio_ano_de_casa: Clock,
  um_ano_de_casa: CalendarCheck,
  velha_guarda: Hourglass,
  embaixador: Globe,
  // ── as 53 de 29 set (migration_achievements_100.sql) ──
  semana_sim_semana_sim: CalendarRange,
  trimestre_de_ferro: Dumbbell,
  ano_sem_falhar: CalendarHeart,
  sete_dias: LayoutGrid,
  turno_da_noite: Moon,
  fim_de_tarde: Sunset,
  regressado: RotateCcw,
  anos_a_jogar: Cake,
  turista: MapPin,
  campo_1: Flag,
  escalada: ArrowUpToLine,
  do_fundo_ao_topo: ArrowBigUpDash,
  rosca: Egg,
  rosca_dupla: CircleSlash2,
  punto_de_oro: Coins,
  nervos_de_aco: Anchor,
  tie_break: Timer,
  todos_os_formatos: Layers,
  final_four: Trophy,
  em_chamas: Flame,
  imparavel: Zap,
  hat_trick: Hash,
  meio_milhar: BarChart3,
  recorde_da_casa: Crosshair,
  contra_a_corrente: ArrowUpDown,
  dez_parceiros: Users,
  sociavel: UsersRound,
  toda_a_gente: Globe,
  dupla_de_sempre: Link,
  quimica: Sparkles,
  inscricao_a_dois: HeartHandshake,
  salto_do_banco: Bell,
  suplente_de_luxo: Star,
  in: MessageCircle,
  rei_do_in: Smartphone,
  primeiro_a_chegar: Rocket,
  organizador: ListOrdered,
  anfitriao: Home,
  sessao_completa: Repeat,
  rivalidade: Swords,
  jogo_de_grupo: Compass,
  liga_interna: Scale,
  estreia_em_torneio: Plane,
  podio: Medal,
  campeao: Trophy,
  bicampeao: Crown,
  invicto_no_torneio: Shield,
  cabeca_de_serie: Target,
  aula_experimental: BookOpen,
  aluno_aplicado: GraduationCap,
  recrutador: UserPlus,
  premio_levantado: Gift,
  cartao_completo: Award,
  // As três da estrada (21 out).
  deste_boleia: Car,
  primeira_rotunda: RotateCw,
  ate_a_porta: DoorOpen,
  // O pódio do ranking do mês (26 out).
  podio_do_mes: CalendarCheck,
  quebra_enguico: Unlock,
}

// Troféus de evento (ou futuros) sem ícone dedicado caem aqui.
export const achievementIcon = (key, category) =>
  ICONS[key] || (category === 'evento' ? Ticket : category === 'torneio' ? Trophy : category === 'aulas' ? GraduationCap : Award)

// Linguagem universal de raridade. Literais completos — o scanner do
// Tailwind não vê classes construídas. `medal` é o medalhão preenchido do
// troféu ganho; `glow` acende nos tiers altos para os ganhos gritarem na
// grelha ao lado dos bloqueados (feedback do Ruben: não se percebia bem
// quais estavam ganhos).
export const RARITY_META = {
  comum: {
    labelKey: 'achievements.rarity_comum',
    frame: 'border-stone-400', icon: 'text-stone-600',
    medal: 'bg-stone-200', pill: 'bg-stone-100 text-stone-600', glow: '',
  },
  raro: {
    labelKey: 'achievements.rarity_raro',
    frame: 'border-sky-400', icon: 'text-sky-600',
    medal: 'bg-sky-100', pill: 'bg-sky-100 text-sky-700', glow: '',
  },
  epico: {
    labelKey: 'achievements.rarity_epico',
    frame: 'border-violet-400', icon: 'text-violet-600',
    medal: 'bg-violet-100', pill: 'bg-violet-100 text-violet-700',
    glow: 'shadow-[0_0_14px_-2px] shadow-violet-400/60',
  },
  lendario: {
    labelKey: 'achievements.rarity_lendario',
    frame: 'border-amber-400', icon: 'text-amber-600',
    medal: 'bg-amber-100', pill: 'bg-amber-100 text-amber-700',
    glow: 'shadow-[0_0_14px_-2px] shadow-amber-400/70',
  },
}

/** A «% têm» com a vírgula de cá («24,1»), e com o ponto em inglês. */
export const formatRarityPct = (pct, lang = 'pt') =>
  Number(pct).toLocaleString(localeOf(lang), { maximumFractionDigits: 1 })

export const CATEGORY_ORDER = ['jogo', 'torneio', 'elo', 'xp', 'kudos', 'aulas', 'antiguidade', 'evento']

/* ── Quando e com quem (design-handoff/2026-10-21-conquistas-quando-e-
   quebra-enguico, aprovado a 21 out). A get_player_achievements_v2 (Dev 3)
   traz o dia, o evento, o parceiro e, na Quebra Enguiço, a dupla vencida, já
   com a privacidade da base. Sem ela (antes de o SI a correr), a de sempre:
   o cartão aberto fica como estava. */
export async function loadPlayerAchievements(supabase, userId) {
  const v2 = await supabase.rpc('get_player_achievements_v2', { p_user_id: userId })
  if (!v2.error) return v2
  if (!/get_player_achievements_v2|PGRST202|42883/i.test(`${v2.error.code} ${v2.error.message}`)) return v2
  return supabase.rpc('get_player_achievements', { p_user_id: userId })
}

/** O «quando e com quem» de uma linha, ou null (a função antiga não o traz). */
export function achievementContext(row) {
  if (!row || !row.context) return null
  return {
    context: row.context,
    on: row.event_on || null,
    before: row.before_on || null,
    eventKind: row.event_kind || null,
    eventId: row.event_id || null,
    eventTitle: row.event_title || null,
    partner: row.partner_id || row.partner_name
      ? { id: row.partner_id || null, name: row.partner_name || null, linkable: !!row.partner_id && row.partner_linkable !== false }
      : null,
    beaten: Array.isArray(row.beaten) ? row.beaten : [],
  }
}

/** «14 out», ou «14 out 2025» se for de outro ano. `iso` = 'YYYY-MM-DD'. */
export function achievementDay(iso, locale, now = new Date()) {
  if (!iso) return ''
  const d = new Date(`${String(iso).slice(0, 10)}T12:00`)
  if (Number.isNaN(d.getTime())) return ''
  const month = d.toLocaleDateString(locale, { month: 'short' }).replace(/\./g, '')
  return d.getFullYear() === now.getFullYear() ? `${d.getDate()} ${month}` : `${d.getDate()} ${month} ${d.getFullYear()}`
}

/** «novembro», o mês do dia `iso` ('YYYY-MM-DD'), na língua de quem vê. */
export function achievementMonth(iso, locale) {
  if (!iso) return ''
  const d = new Date(`${String(iso).slice(0, 10)}T12:00`)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { month: 'long' })
}

/** Para onde leva o evento (o jogo de grupo não tem página própria). */
export function achievementEventPath(ctx) {
  if (!ctx?.eventId) return null
  if (ctx.eventKind === 'mix') return `/jogo/${ctx.eventId}`
  if (ctx.eventKind === 'torneio') return `/torneio/${ctx.eventId}`
  if (ctx.eventKind === 'amigos') return `/jogos-privados/sessao/${ctx.eventId}`
  return null
}

/** «e» entre dois nomes. Em espanhol, «y» passa a «e» antes de um som «i»
 *  («Ana e Inés», «Pedro e Hilario»), mas não antes de «hie»/«hia» (Copywriter). */
export function andWord(t, locale, nextName) {
  const word = t('achievements.when_and')
  if (String(locale || '').startsWith('es') && /^h?[iíIÍ](?![aeoáéó])/i.test(String(nextName || '').trim())) return 'e'
  return word
}
