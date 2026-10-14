// Ficheiro de /assets/ que não existe (PO, 14 out — para o main de sexta).
//
// O vercel.json manda para aqui os pedidos a /assets/… que não encontram
// ficheiro (os que existem são servidos antes, sem passar por cá).
//
// PORQUÊ. O 404 normal da Vercel vem com «guardar 4 horas». Logo a seguir a
// uma versão nova, um telemóvel pode pedir o ficheiro principal um instante
// antes de ele chegar à região: recebe o 404 e guarda-o. Durante 4 horas a
// app não abre nesse telemóvel, nem com refresh. Aqui o 404 sai com
// «não guardar», e o pedido seguinte já encontra o ficheiro.
//
// Continua a ser 404 e não o index.html (Ruben, 29 set: um CSS que recebia
// o index.html ficava guardado como página e a app abria sem estilos).
// Sem registos por pedido: há robôs que varrem /assets/* (SI, 14 out).
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  return res.status(404).end('Not Found')
}
