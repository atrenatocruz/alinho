// As cores de cada tipo de evento — o ÚNICO sítio onde estão (R0 do redesign,
// design-handoff/2026-10-13-redesign/R0-cores-e-alino.md, aprovado pelo
// Francisco a 13 out). O tailwind.config.js lê esta tabela, por isso as
// classes saem daqui: bg-kind-mix, text-kind-mix-dark, bg-kind-mix-light,
// border-kind-mix-line (e o mesmo para open, free, tournament, league,
// lesson, friends). No JavaScript (mapa, estilos em linha): KIND_COLORS.
//
// strong — a faixa, a pastilha do tipo, o ponto dos filtros, o pino do mapa;
//          o texto em cima é sempre branco (todas passam AA com branco).
// dark   — texto sobre o fundo claro.
// light  — os fundos.
// line   — contornos finos sobre o fundo claro (22 % da forte sobre branco).
//
// A cor do tipo nunca vai para um botão de ação: o lima continua a ser só a
// ação principal e «os teus».
export const KIND_COLORS = {
  mix:        { strong: '#1D4ED8', dark: '#14369A', light: '#EEF3FF', line: '#CDD8F6' },
  open:       { strong: '#C2410C', dark: '#8F2F08', light: '#FFF1EA', line: '#F2D5CA' },
  // Horários livres: da família do jogo em aberto, mais claros, para não se
  // confundirem com ele (ponto e contorno #F2BFA8, fundo o claro do aberto).
  free:       { strong: '#F2BFA8', dark: '#8F2F08', light: '#FFF1EA', line: '#F2BFA8' },
  tournament: { strong: '#5B21B6', dark: '#3F1784', light: '#F3EEFF', line: '#DBCEEF' },
  league:     { strong: '#BE185D', dark: '#8A1145', light: '#FCE7F3', line: '#F1CCDB' },
  lesson:     { strong: '#15803D', dark: '#0F5A2B', light: '#E7F6EE', line: '#CCE3D4' },
  friends:    { strong: '#374151', dark: '#1F2937', light: '#EEF0F3', line: '#D3D5D9' },
}

// A ordem dos tipos, igual em todo o lado (filtros, «+ Criar», legendas):
// a da barra da Home.
export const KIND_ORDER = ['mix', 'open', 'free', 'tournament', 'league', 'lesson', 'friends']

// As imagens do topo (o Alino de cada tipo), em public/topo/. Carregam só
// quando aparecem (loading="lazy"); por baixo fica sempre a cor forte —
// ver <KindHero>.
// 900×450: o topo do evento (R3) e o criar (R10).
export const KIND_HERO = {
  mix: '/topo/topo-mix.webp',
  open: '/topo/topo-aberto.webp',
  tournament: '/topo/topo-torneio.webp',
  league: '/topo/topo-liga.webp',
  lesson: '/topo/topo-aula.webp',
  friends: '/topo/topo-amigos.webp',
}
// 920×400: o clube ou o grupo sem foto (R5, R8, R9).
export const CLUB_HERO = '/topo/topo-clube-alino.webp'
export const GROUP_HERO = '/topo/topo-grupo-alino.webp'
// 384×384: o círculo do clube ou do grupo sem foto — uma imagem própria,
// centrada nas caras, em vez de cortar a do topo (Francisco, 14 out, clube
// «A»; design-handoff/2026-10-14-avatares-clube-grupo).
export const CLUB_AVATAR = '/topo/avatar-clube.webp'
export const GROUP_AVATAR = '/topo/avatar-grupo.webp'
