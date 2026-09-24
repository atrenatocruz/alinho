// A frase que se mostra quando a base de dados recusa uma coisa (Trello #476).
//
// As funções do torneio levantam erros com um código curto — «entry_on_waitlist»,
// «entries_closed» — e o Postgres entrega-os com prefixos à frente. Isto tira o
// código do fim da mensagem e procura a frase correspondente.
//
// ⚠️ A REGRA QUE FALHAVA: a versão anterior usava `[a-z_]+`, sem algarismos.
// Com «player1_gender_required» ficava-se por «_gender_required» — uma chave
// que não existe — e a pessoa lia «Não foi possível. Tenta outra vez.» quando
// só lhe faltava escolher o género. É um dos casos que aparece nas inscrições
// do Smash Cup, dos dois lados: jogador e organizador.
//
// Se não houver frase para o código, sai a genérica: ninguém vê códigos em
// bruto, que era a outra coisa que já estava bem feita e não se perde.

/** O código do fim da mensagem, ou '' se não houver nenhum. */
export function errorCode(error) {
  const message = typeof error === 'string' ? error : error?.message
  return String(message || '').trim().match(/([a-z][a-z0-9_]*)$/)?.[1] || ''
}

/** A frase a mostrar. `t` é o tradutor; `prefix` permite reaproveitar isto
 *  noutros sítios sem lhes impor o prefixo do torneio. */
export function signupErrorMessage(t, error, prefix = 'tsignup.error_') {
  const key = `${prefix}${errorCode(error)}`
  return t(key) === key ? t(`${prefix}generic`) : t(key)
}
