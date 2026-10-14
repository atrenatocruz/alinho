// O que está mal num email escrito à mão, em português simples, em vez da
// bolha do browser (na língua dele, às vezes com «uma parte seguida de @»).
// Pedido do Francisco/QA, textos da UX (13 out). Mostra-se só o primeiro
// problema, por esta ordem: vazio, espaços, @, fim.
// 'empty' | 'spaces' | 'at' | 'end' | null (está certo).
export function emailProblem(value) {
  const v = String(value ?? '')
  if (!v.trim()) return 'empty'
  if (/\s/.test(v.trim())) return 'spaces'
  const at = v.indexOf('@')
  if (at < 1) return 'at'
  const domain = v.slice(at + 1).trim()
  // Depois do @ tem de vir um domínio com ponto («gmail.com»): sem ele o
  // email não chega a lado nenhum.
  if (!/^[^@\s]+\.[^@\s.]{2,}$/.test(domain)) return 'end'
  return null
}
