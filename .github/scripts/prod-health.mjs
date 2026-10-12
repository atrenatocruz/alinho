/**
 * Alarme de produção: a API do alinho-prd responde?
 *
 * Porquê (12 out 2026): o PostgREST ficou 83 min preso com PGRST003 e a base
 * de dados sempre saudável — ninguém deu por isso durante mais de uma hora, e
 * só um «Restart project» resolveu. Isto corre de 5 em 5 min (prod-health.yml)
 * e avisa no #dev-updates quando a API cai e quando volta.
 *
 * Sem estado guardado: o job falha (exit 1) quando a API está em baixo, e o
 * estado anterior é a conclusão da última corrida deste workflow. Assim avisa
 * uma vez quando cai e uma vez quando volta, sem repetir a cada 5 min.
 *
 * Ambiente: PROD_SUPABASE_ANON_KEY (a chave pública, a mesma do site),
 * SLACK_WEBHOOK_URL (Incoming Webhook do #dev-updates) ou SLACK_BOT_TOKEN,
 * GITHUB_TOKEN, GITHUB_REPOSITORY, RUN_URL.
 */

const API = 'https://subiamucdrhxsxuippmy.supabase.co'
const SLACK_CHANNEL = 'C0BT8GXF62H' // #dev-updates
const ATTEMPTS = 3
const PAUSE_MS = 20_000
const TIMEOUT_MS = 15_000

const { PROD_SUPABASE_ANON_KEY: KEY, SLACK_WEBHOOK_URL: WEBHOOK, SLACK_BOT_TOKEN: SLACK, GITHUB_TOKEN, GITHUB_REPOSITORY, RUN_URL } = process.env

if (!KEY) {
  console.log('Falta o segredo PROD_SUPABASE_ANON_KEY — nada a verificar.')
  process.exit(0)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Uma ida à API REST, como a app faz. Devolve { ok, detail }. */
async function probe() {
  try {
    const res = await fetch(`${API}/rest/v1/organizations?select=id&limit=1`, {
      headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.text()).slice(0, 200)
    return { ok: res.ok, detail: `${res.status} ${body}` }
  } catch (err) {
    return { ok: false, detail: `sem resposta (${err.name === 'TimeoutError' ? `timeout ${TIMEOUT_MS / 1000}s` : err.message})` }
  }
}

/** Conclusão da última corrida terminada deste workflow (antes desta). */
async function previousConclusion() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/prod-health.yml/runs?status=completed&per_page=10`,
      { headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json' } }
    )
    const { workflow_runs: runs = [] } = await res.json()
    // Corridas canceladas ou interrompidas não dizem nada sobre a API.
    return runs.find((r) => r.conclusion === 'success' || r.conclusion === 'failure')?.conclusion ?? null
  } catch (err) {
    console.log('Não consegui ler as corridas anteriores:', err.message)
    return null
  }
}

async function slack(text) {
  // Um Incoming Webhook já vem preso a um canal — é a forma mais simples.
  if (WEBHOOK) {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text, unfurl_links: false }),
    })
    if (!res.ok) console.log(`Slack recusou o webhook: ${res.status} ${await res.text()}`)
    return
  }
  if (!SLACK) {
    console.log('Sem SLACK_WEBHOOK_URL nem SLACK_BOT_TOKEN — mensagem não enviada:\n' + text)
    return
  }
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { authorization: `Bearer ${SLACK}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: SLACK_CHANNEL, text, unfurl_links: false }),
  })
  const body = await res.json()
  if (!body.ok) console.log(`Slack recusou: ${body.error}`)
}

// Só conta como em baixo se falhar as 3 tentativas (~1 min): um soluço de
// rede não acorda ninguém.
let last
for (let i = 1; i <= ATTEMPTS; i++) {
  last = await probe()
  console.log(`Tentativa ${i}: ${last.ok ? 'ok' : 'falhou'} — ${last.detail}`)
  if (last.ok) break
  if (i < ATTEMPTS) await sleep(PAUSE_MS)
}

const previous = await previousConclusion()
console.log(`Corrida anterior: ${previous ?? 'nenhuma'}`)

if (last.ok) {
  if (previous === 'failure') {
    await slack(':white_check_mark: *Produção voltou* — a API do alinho.pt está a responder outra vez.')
  }
  process.exit(0)
}

if (previous !== 'failure') {
  await slack(
    [
      ':rotating_light: *Produção em baixo* — a API do alinho.pt não responde (3 tentativas em ~1 min).',
      `Última resposta: \`${last.detail.replace(/`/g, "'")}\``,
      'Se for `PGRST003`/`PGRST002` (como a 12 out): Supabase → alinho-prd → *Settings → Restart project*, e digam aqui quem reiniciou.',
      RUN_URL ? `Detalhes: ${RUN_URL}` : '',
    ].filter(Boolean).join('\n')
  )
}
process.exit(1)
