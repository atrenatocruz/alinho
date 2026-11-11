# Relógio no mix, Fase B: os pontos do relógio ao vivo na app

Data: 11 nov 2026 · Pedido do Renato · Estado: rascunho para aprovar

Continua a spec de 26 out (`2026-10-26-relogio-mix-a-decorrer-design.md`). Essa
spec já decidiu o que a Fase B faz; esta fixa o como.

## Porquê

A Fase A já está viva: no relógio, um dos 4 carrega em «Começar», conta o jogo, e
no fim o resultado fica gravado no mix (prod, 11 nov: um jogo gravado 2-0 pelo
relógio). Durante o jogo, porém, a app não mostra nada. O relógio só fala com o
Supabase duas vezes: no «Começar» (`claim_mix_match`) e no fim
(`save_mix_match_result`). As colunas `mix_live_scores.seq` e `state` existem mas
ficam sempre vazias.

Sucesso: com dois telemóveis a ver e um relógio a contar, o placar «A decorrer
agora» e a página do mix mostram o ponto novo em 2–3 s ou menos, sem recarregar.

## Já decidido (spec de 26 out)

- O que se vê são **os pontos a mexer** (15/30/40), não só os jogos.
- O ao vivo segue **as mesmas regras de leitura de `matches`**.
- **A contagem no relógio é a verdade.** A rede só serve para mostrar o jogo a
  quem está de fora. Se falhar, o relógio continua a contar como se nada fosse.
- No envio ganha o último estado e não há fila: se um envio falhar, o ponto
  seguinte corrige.
- Se o relógio deixar de mandar pontos durante mais de 3 minutos, o campo fica só
  com os jogos.

## Fora do âmbito

- Passar o jogo a outro relógio (Fase C).
- Quem pode contar (hoje qualquer um dos 4; o protótipo de 27 out diz «só os
  marcadores»). É outra decisão, noutra migração.
- Relógio da ronda, aquecimento, troca, pausa do mix e «Contar só para mim».
- Jogos entre amigos, torneios, Android/Wear OS.

## Como fica (o que se vê)

### Página do mix (`GameDetails`)

Num jogo da ronda **sem resultado** e com estado ao vivo fresco (menos de 3 min):

- ao lado do jogo, os jogos do set e os pontos, por exemplo **«4-3 · 30-15»**,
  com um pequeno ícone de relógio;
- tie-break: «6-6 · TB 5-4»; super tie-break: «1-1 · STB 7-5»;
- Pontos corridos: «18-14»; Set sem fim: «5-3 · 30-15»;
- vantagem: «40-Vant.»; em pausa: «Em pausa» no lugar dos pontos;
- sets já fechados antes do set atual, como no relógio: «6-4 · 2-1 · 15-0».

Quando o jogo passa a ter resultado, o ao vivo desaparece e fica o resultado de
sempre. Nada muda nos jogos sem relógio.

### «A decorrer agora» (`LiveNowLine` → `LiveBoard`)

- Cada campo com ao vivo fresco mostra o mesmo texto, por baixo dos jogos (cartão
  grande) ou ao lado (linhas dos outros campos), com o ícone do relógio.
- Com a folha aberta, a página atualiza-se sozinha a cada ponto. Com a folha
  fechada, mantém-se como hoje: carrega uma vez.
- Um campo escondido (`a_hidden`/`b_hidden`, ou seja, `live_hides_results`) também
  esconde o ao vivo.

## Como funciona por dentro (minhas escolhas, para contestar)

### O `state` (versão 1)

O `state` é escrito na perspetiva do jogo do mix (**dupla A / dupla B**), não do
relógio («nós/eles»). O relógio converte usando o `MixLink.side`. Os pontos
chegam já como texto, para a web não ter de reimplementar as regras do 40-40 (ponto
de ouro, Star Point, vantagens).

```json
{
  "v": 1,
  "sets":   [[6, 4]],
  "games":  [2, 1],
  "points": ["15", "0"],
  "phase":  "game",
  "server": "a",
  "paused": false,
  "over":   false
}
```

- `sets`: os sets fechados, `[A, B]`. No super tie-break entra só o resultado.
- `games`: os jogos do set em curso, `[A, B]`. Nos Pontos corridos fica `[0, 0]`.
- `points`: `"0" "15" "30" "40" "AD"` num jogo; o número cru num tie-break, num
  super tie-break ou nos Pontos corridos. `"AD"` é traduzido pela web («Vant.»).
- `phase`: `game | tie_break | super_tie_break | points` (vem de
  `MatchState.phase`). Nos Pontos, `pointsScoring = games` (Set sem fim) envia
  `game`, porque se conta 15-30-40.
- `server`: `"a" | "b" | null` (o relógio pode não saber quem serve).
- `paused`, `over`: o que o nome diz.

O formato só cresce. Um campo novo não parte a web antiga, e a web ignora um `v`
que não conhece.

### Base de dados: `migration_relogio_mix_b.sql`

1. **`mix_live_scores.game_id`** (UUID, `REFERENCES games ON DELETE CASCADE`):
   preenchido pelo `claim_mix_match` e pelo backfill das linhas que já existem.
   É o filtro do Realtime (`game_id=eq.…`). A tabela ainda só é usada pelas RPCs,
   por isso a coluna nova não parte nada.
2. **Leitura (RLS)**: uma política `SELECT` com a mesma regra que
   `"Org members can view matches"`, ou seja, é membro do clube do mix. Reusar ou
   criar **uma** função auxiliar (por exemplo `can_view_match(match_id)`) em vez de
   mais um `EXISTS` copiado (ver CLAUDE.md). Continuam sem `INSERT/UPDATE/DELETE`
   para clientes; o `GRANT SELECT` é só para `authenticated`.
3. **`push_mix_live_score(p_match_id uuid, p_seq int, p_state jsonb) → jsonb`**,
   `SECURITY DEFINER`. Aceita o envio só se:
   - `auth.uid()` for o `scorer_id` da linha, e ainda um dos 4 (a mesma junção às
     equipas que a Fase A usa no `save_mix_match_result`);
   - o mix estiver `in_progress` e o jogo ainda não tiver resultado;
   - `p_state` for um objeto e tiver no máximo 2 KB.

   Grava `state`, `seq` e `updated_at = now()` só se `p_seq > seq`. Um `seq` igual
   ou menor dá OK e não muda nada (é um envio atrasado). Erros: `not_scorer`,
   `not_live`, `has_result`, `bad_state`.
4. **Publicação Realtime**: `ALTER PUBLICATION supabase_realtime ADD TABLE
   mix_live_scores`, com a mesma guarda «já estava» das migrações de tempo real.
5. **`live_mix_courts`**: cada campo ganha `live`, que é o `state` se
   `updated_at > now() - interval '3 minutes'` e o jogo não tiver resultado, ou
   `null` caso contrário. A frescura é calculada no servidor (o relógio do
   telemóvel pode estar adiantado). Num campo `hidden`, `live` é `null`. Esta troca
   é feita no corpo VIVO, com a guarda «já estava», como as outras.

A migração **tem de ser corrida à mão**: primeiro no dev, depois em produção, e
antes de qualquer push para `main` da web que dependa dela.

### Relógio

- O `seq` são os milissegundos do relógio (`max(anterior + 1, agora)`), e
  `mix_live_scores.seq` passa a `BIGINT`. Assim o `seq` continua a subir depois
  de a app reiniciar a meio do jogo, ou de um novo «Começar» do mesmo dono, sem
  ser preciso gravá-lo.
- `MixModel.pushLive(_ state: MatchState)` monta o `state` v1 e
  guarda-o como «o último por enviar». Há um único pedido no ar de cada vez; quando
  acaba, se entretanto chegou um estado mais novo, envia esse. Uma falha de rede
  não tenta outra vez sozinha: o próximo ponto, ou o `tick` de 30 s que já existe,
  envia o último. Nada vai para disco além do `liveSeq`.
- Chama-se no `AppModel.save()`, que já corre depois de cada mudança (ponto,
  desfazer, acertar, pausa, quem serve), e logo a seguir ao «Começar». Só envia
  no jogo ligado ao mix e só se o placar mudou.
- No fim do jogo, envia o estado com `over: true` e depois segue o
  `save_mix_match_result` pela `ResultOutbox`, como hoje. A web já esconde o ao
  vivo quando há resultado; o `over` serve só para a página não mostrar «40-30»
  durante o segundo que o resultado demora a chegar.
- Respostas `has_result`, `not_scorer` e `not_live`: param os envios ao vivo deste
  jogo e **não mexem na contagem**. `unavailable` (404, migração por correr):
  pára em silêncio. `signedOut`: o mesmo caminho que a fila já usa.
- O ecrã do relógio não muda.

### Web

- **`GameDetails`**:
  - em `runLoadGameDetails`, lê `mix_live_scores` (`match_id, state, updated_at`)
    do `game_id`. Um erro (tabela sem permissão, migração por correr) dá mapa
    vazio e segue sem ao vivo;
  - abre um 5.º canal `mix_live_scores` com `game_id=eq.${id}` que **aplica o
    `payload.new` ao mapa**, sem `reloadSoon`. Recarregar a página inteira a cada
    ponto, com 4 campos, era demasiado. Um canal recusado (tabela fora da
    publicação) não afeta os outros, porque já há um canal por tabela;
  - um `setInterval` de 30 s volta a calcular os 3 minutos. Aqui usa-se
    `Date.now()` contra `updated_at`; se o relógio do telemóvel estiver muito
    errado, o pior que pode acontecer é o ao vivo aparecer ou desaparecer antes do
    tempo;
  - o ao vivo só aparece num jogo onde a página já mostraria o resultado. Quem
    constrói confirma que o `GameDetails` não esconde resultados de quem tem
    `results_visibility` privado. Se esconder, o ao vivo segue a mesma regra.
- **`LiveNowLine`**: com a folha aberta, um canal `mix_live_scores` (sem filtro, a
  RLS limita ao que a pessoa pode ler) chama `listLiveEvents()` com um debounce de
  1 s. Fecha-se o canal quando a folha fecha.
- **`LiveBoard`**: mostra `court.live` com o ícone (`Watch` do lucide). O texto sai
  de uma função pura `liveScoreText(state, t)` em `src/lib/mixLiveScore.js`, com
  testes vitest para cada fase, vantagem, pausa e `v` desconhecido.
- i18n: `live.watch_paused`, `live.watch_adv`, `live.watch_tb`, `live.watch_stb`
  (pt-PT, en).

### Segurança: o que impede chamar a RPC à mão?

- **Escrever:** só o `scorer_id`, ainda um dos 4, com o mix a decorrer e sem
  resultado. Um estranho que chame `push_mix_live_score` recebe `not_scorer`. O
  `state` não entra em nenhum resultado, ranking ou estatística: é só para
  mostrar. Por isso, um `state` falso (o marcador a mentir) é igual a mentir ao
  meter o resultado, e o resultado final continua a passar pelas travas do
  `save_mix_match_result`.
- **Ler:** as mesmas pessoas que já leem `matches` desse mix. O Realtime aplica a
  política `SELECT` a cada subscritor. Testar com uma conta de outro clube, que
  não pode receber nada.
- **Tamanho e ritmo:** no máximo 2 KB por envio. Um ponto a cada ~20 s por campo
  é muito pouco para o Realtime.

### Compatibilidade

- As apps iOS antigas (com os ecrãs dentro da app) não leem a tabela nem o `live`
  novo: ficam como hoje. A web antiga também.
- Um relógio antigo (só Fase A) nunca chama a RPC nova: a página fica sem ao vivo,
  como hoje.
- Um relógio novo contra uma base de dados sem a migração recebe 404: pára os
  envios ao vivo e conta normalmente.

## Teste

1. Dev: mix com 4 contas e 2 campos. O relógio fica com o campo 1. Dois
   telemóveis: um no `GameDetails`, outro com a folha «A decorrer agora» aberta.
2. Cada ponto aparece nos dois em 3 s ou menos. Também o desfazer, a pausa, o
   tie-break e a vantagem (num mix com vantagens).
3. Modo avião no relógio durante 2 pontos, depois volta a ligar: o próximo ponto
   mostra o estado certo. A contagem no relógio não foi afetada.
4. Relógio desligado durante 4 minutos: o campo volta a mostrar só os jogos.
5. Fim do jogo: o ao vivo desaparece e fica o resultado.
6. Uma conta de outro clube abre o Realtime à mão (consola) e não recebe nada. Uma
   conta que não é o marcador chama a RPC e recebe `not_scorer`.
7. vitest: `liveScoreText`. Swift: o `state` v1 a partir do `MatchState` (lado A e
   lado B, cada fase) e o `seq` a crescer depois de um reinício.

Entrega: migração no dev → web em `dev` → build do relógio no Codemagic (manual)
→ testes acima → migração em produção → `main`.

## Para confirmar (Renato)

1. O formato do texto: «4-3 · 30-15», com os sets fechados à frente.
2. 3 minutos sem envios → o campo fica só com os jogos (vem da spec de 26 out).
   Com a pausa do mix (protótipo de 27 out) isto pode ter de mudar. Por agora uma
   pausa no relógio também deixa de se ver ao fim de 3 min.
3. A folha «A decorrer agora» só fica ao vivo enquanto está aberta. A linha da
   Home (o contador) continua a carregar uma vez.
