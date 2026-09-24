// Pesquisa de nomes que ignora acentos e maiúsculas: «goncalves» encontra
// «Gonçalves», «joao» encontra «João». Ninguém escreve cedilhas e acentos
// numa pesquisa no telemóvel (Francisco, 24 set 2026). Um sítio só, para
// todos os ecrãs que filtram nomes no telemóvel usarem a mesma regra — do
// lado da base de dados, a mesma regra chama-se sem_acentos().

/** Texto sem acentos e em minúsculas. */
export const semAcentos = (texto) => (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** O `texto` contém a `pesquisa`, sem contar acentos nem maiúsculas. Pesquisa vazia → true. */
export const contemTexto = (texto, pesquisa) => semAcentos(texto).includes(semAcentos(pesquisa).trim())
