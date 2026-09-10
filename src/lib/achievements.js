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
import {
  Rocket, Footprints, Coffee, Home, Milestone, Landmark, CalendarDays,
  CalendarCheck, CalendarClock, Moon, Sunrise, Sun, Megaphone, Flame,
  Medal, Crown, Sparkles, Repeat, Trophy, Cpu, TrendingUp, HeartHandshake,
  Route, Infinity as InfinityIcon, Target, ArrowUpRight, ChevronsUp,
  Star, Mountain, Swords, Shield, Award, Gem, Diamond, ThumbsUp, Heart,
  Smile, Key, Clock, Hourglass, Globe, Ticket,
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
}

// Troféus de evento (ou futuros) sem ícone dedicado caem aqui.
export const achievementIcon = (key, category) =>
  ICONS[key] || (category === 'evento' ? Ticket : Award)

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

export const CATEGORY_ORDER = ['jogo', 'elo', 'xp', 'kudos', 'antiguidade', 'evento']
