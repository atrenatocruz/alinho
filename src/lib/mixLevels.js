// Níveis dos mixes (Trello #577, Francisco 26 set): Masculino (M), Feminino
// (F) e Misto (MX), cada um de 1 a 6 — sem N. O código é o mesmo dos
// torneios («M5», «F3», «MX4») e o que o robô percebe («In mx4»). A base de
// dados aceita estes 18 valores (migration_niveis_mx.sql, Dev 3).

export const LEVEL_SCALES = ['M', 'F', 'MX']
// Do 6 (quem começa) ao 1, como sempre se mostrou.
export const LEVEL_NUMBERS = [6, 5, 4, 3, 2, 1]
export const ALL_LEVELS = LEVEL_SCALES.flatMap((s) => LEVEL_NUMBERS.map((n) => `${s}${n}`))

/** «MX4» → { scale: 'MX', num: 4 }; qualquer outra coisa → null. */
export function parseLevel(level) {
  const m = /^(MX|M|F)([1-6])$/.exec(String(level || '').toUpperCase())
  return m ? { scale: m[1], num: Number(m[2]) } : null
}

/** O número do nível («MX4» → '4'), para comparar com o nível de quem vê. */
export const levelNumber = (level) => {
  const p = parseLevel(level)
  return p ? String(p.num) : null
}

/** O escalão que faz sentido para «Quem pode entrar». */
export function scaleForGender(gender) {
  if (gender === 'feminino') return 'F'
  if (gender === 'misto') return 'MX'
  return 'M'
}
