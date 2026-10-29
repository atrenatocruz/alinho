# Escolhe a tua raquete — como ligar

Spec: `docs/superpowers/specs/2026-10-27-escolher-raquete-design.md`.
Plano: `docs/superpowers/plans/2026-10-27-escolher-raquete.md`.

O código está no repo, mas **nada disto funciona até se fazer o que está abaixo**,
primeiro no dev e depois em produção (antes de o código ir para `main`). Sem isto,
o cartão aparece no Perfil mas o questionário acaba em «Não deu para escolher as
raquetes».

## Peças

| Peça | Onde | O que faz |
|---|---|---|
| `rackets` | `supabase/migration_escolher_raquete.sql` | Cópia das raquetes da Street Padel |
| `racket_picks` | idem | A última recomendação de cada jogador (só o próprio a lê) |
| `racket_pick_runs` + `take_racket_run` | idem | Limite de 3 por jogador por dia de Lisboa |
| cron `sync-raquetes` | idem | Chama o sync às 05:00 UTC |
| `sync-raquetes` | `supabase/functions/sync-raquetes` | Copia o catálogo |
| `recomendar-raquete` | `supabase/functions/recomendar-raquete` | Lista curta → Gemini → validação → grava |
| lógica partilhada | `supabase/functions/_shared/raquetes.js` | Loja, parse, specs, lista curta, prompt, validação (testes com vitest) |

## Ligar (dev primeiro, depois produção)

1. **Chave do Gemini.** Em https://aistudio.google.com criar uma API key (plano
   gratuito). Ver lá o limite real de pedidos por dia do modelo Flash (o Google
   deixou de o publicar) e qual é o Flash mais recente disponível no plano gratuito.
   A quota é por projeto do Google: o dev e a produção gastam a mesma.
2. **Secrets** (Supabase → Edge Functions → Secrets, em cada projeto):
   - `GEMINI_API_KEY` — a chave do passo 1;
   - `GEMINI_MODEL` — opcional: um ou mais modelos separados por vírgulas, tentados por
     ordem quando um está cheio (503) ou sem quota (429). Por omissão
     `gemini-flash-latest,gemini-flash-lite-latest`. A 27 out o Flash deu 503 «high
     demand» várias vezes seguidas e o Flash-Lite respondeu em ~5 s com 3 raquetes válidas;
   - `SYNC_RAQUETES_SECRET` — um valor aleatório comprido, inventado por ti.
3. **Funções:**
   ```bash
   npx supabase functions deploy sync-raquetes --no-verify-jwt --project-ref <projeto>
   npx supabase functions deploy recomendar-raquete --project-ref <projeto>
   ```
   O `sync-raquetes` vai com `--no-verify-jwt` porque quem o chama é o cron, com o
   cabeçalho `x-sync-secret`, não um utilizador.
4. **Migração.** Abrir `supabase/migration_escolher_raquete.sql`, trocar os dois
   `<PREENCHER …>` do fim (o URL do projeto e o valor de `SYNC_RAQUETES_SECRET`) e
   correr no SQL Editor. **Não fazer commit do ficheiro com o segredo.**
5. **Teste das regras.** Correr `supabase/tests/escolher_raquete.sql` com dois ids de
   jogadores: todas as linhas têm de dar `OK`.
6. **Primeiro sync, à mão:**
   ```bash
   curl -X POST -H "x-sync-secret: $SEGREDO" https://<projeto>.supabase.co/functions/v1/sync-raquetes
   ```
   Tem de dar `200` com `rackets` perto de 700 e `available` perto de 300.
   `select count(*) from rackets where available;` dá o mesmo.
7. **Uma recomendação**, com o JWT de uma conta de teste (copiado da app):
   ```bash
   curl -X POST -H "Authorization: Bearer $JWT" -H "apikey: $ANON" -H "Content-Type: application/json" \
     -d '{"lang":"pt","answers":{"frequency":"1_2","style":"equilibrado","strengths":["voleios"],"struggle":"controlo","pain":["cotovelo"],"feel":"leve","center":"muitas_vezes","wants":"controlo","shape":"redonda","budget":"80_150"}}' \
     https://<projeto>.supabase.co/functions/v1/recomendar-raquete
   ```
   Tem de dar `200` com 3 `picks` cujos `id` existem em `rackets`, disponíveis e com
   `price <= 150`. A 4.ª chamada no mesmo dia dá `429 {"error":"daily_limit"}`.
8. **Na app:** Perfil → «Escolhe a tua raquete» → as 11 perguntas → as 3 raquetes com
   foto. Voltar ao Perfil: o cartão passa a «As tuas raquetes» com as 3 fotos.

## Erros da função

`401 unauthorized` · `400 bad_answers` · `422 no_candidates` (nada em stock dentro do
orçamento) · `429 daily_limit` · `503 ai_unavailable` (Gemini sem quota, em baixo ou
lento) · `502 ai_failed` (duas respostas inválidas da IA) · `500 server_error`.
Os logs só têm o código: nunca as respostas (há respostas sobre dores) nem o prompt.

## Trocar

- **De modelo:** mudar o secret `GEMINI_MODEL` (lista separada por vírgulas). Outro fornecedor: só `askGemini` em
  `recomendar-raquete/index.ts`.
- **De loja:** `STORE` e `parseShopifyRacket` em `_shared/raquetes.js` (o link e o nome
  saem daí). Uma loja sem catálogo Shopify precisa de outro parse; o resto fica igual.
  Os textos «Ver na Street Padel ↗» e o rodapé estão em `src/locales/*.json`
  (`raquete.buy`, `raquete.footer`).
- **As perguntas:** `QUESTIONS` em `src/lib/raquete.js` **e** `REQUIRED`/`OPTIONAL` em
  `recomendar-raquete/index.ts` têm de ter as mesmas chaves.
