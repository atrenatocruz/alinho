// A cor de cada nível: o ÚNICO sítio onde está (Francisco, 30 out,
// design-handoff/2026-10-30-cores-dos-niveis). A pastilha do nível fica cheia
// com a cor do número e o texto preto, no fundo claro e no escuro. A cor vem
// só do número: M5, F5, N5 e MX5 são iguais; INI e NINI são a Iniciação.
// O lima fica de fora, porque é só da ação principal e do «tu».
export const LEVEL_COLORS = {
  ini: '#D4D7DC',
  6: '#93B4FF',
  5: '#5EDDF0',
  4: '#86E08A',
  3: '#FFD23F',
  2: '#FF9A3D',
  1: '#FF6B6B',
}

export const LEVEL_TEXT = '#0B0B0C'

/** A cor de um rótulo de nível («M5», «MX3», «N1», «INI», «NINI»…). */
export function levelColor(label) {
  const m = /([1-6])$/.exec(String(label || ''))
  return m ? LEVEL_COLORS[m[1]] : LEVEL_COLORS.ini
}
