# Relógio no mix: contar um jogo do mix e vê-lo «A decorrer» ponto a ponto

Data: 26 out 2026 · Pedido do Renato · Estado: rascunho para aprovar

## Porquê

Num mix, os resultados são metidos à mão no fim de cada jogo, por um admin ou por
quem ele nomeou para marcar resultados (`game_scorekeepers`). Quem está à espera não
sabe como vai cada campo. O relógio já conta o jogo inteiro (spec de 22 out e
protótipo de 23 out), mas o resultado fica isolado: só chega ao iPhone no fim e
apenas como jogo entre amigos.

Queremos duas coisas:

1. **Contar no relógio um jogo do mix de hoje** e, no fim, o resultado ficar
   gravado nesse jogo sem ninguém o escrever.
2. **Ver o jogo a decorrer na app, ponto a ponto** (15, 30, 40, vantagem/ponto de
   ouro e os jogos), no placar «A decorrer agora» e na página do mix, sem recarregar.

Sucesso: num mix com relógio, o admin não mete à mão os resultados dos campos
contados no relógio, e quem está no bar segue esses campos no telemóvel.

## Decidido pelo Renato (26 out)

- Quem conta é sempre **um dos 4 jogadores** do jogo. Combinam entre si: **o
  primeiro a começar o jogo no relógio fica com ele**, e os outros três veem-no
  bloqueado.
- No placar «A decorrer» veem-se **os pontos a mexer** (15/30/40), não só os jogos.
- O resultado vindo do relógio **fica logo final**, como quando é metido à mão. Se
  estiver errado, o admin corrige como hoje.
- Fazer as duas partes, por fases, avançando uma de cada vez.

## Fora do âmbito (não fazer)

- Torneios, ligas e jogos entre amigos. Só jogos de **mix**.
- Pessoas de fora dos 4 a contar (árbitro, admin com o relógio de outro).
- Confirmação do resultado pela outra dupla.
- Mostrar os pontos a quem hoje não vê os resultados do mix: o ao vivo segue as
  mesmas regras de leitura de `matches`.
- Android/Wear OS.
- Estatísticas novas a partir dos pontos (quem ganhou mais pontos ao serviço, etc.).

## Anti-objetivos (falhar mesmo que funcione)

- Dois relógios a contar o mesmo jogo e o placar a saltar entre os dois.
- Um jogador que não está naquele jogo conseguir gravar ou mexer no resultado
  chamando a RPC diretamente. A segurança fica no Postgres, não no relógio.
- O relógio deixar de contar (ou perder pontos) porque a rede falhou. **A contagem
  no relógio é a verdade.** A rede só serve para ver o jogo de fora e para gravar no
  fim, e tem de recuperar sozinha.
- Apps antigas (iPhone ou web) partirem por causa das tabelas novas.

## Como fica (o que se vê)

### No relógio

- Ecrã inicial: além de «Novo jogo», aparece **«Jogos do mix»** quando a pessoa tem
  um mix `in_progress` hoje. A lista mostra os jogos dela: ronda, campo, parceiro e
  adversários (nomes curtos).
- Tocar num jogo e depois **«Começar»**:
  - se ninguém o começou, fica com ele e abre o marcador de sempre, já com os nomes;
    «Nós» é a dupla de quem tem o relógio;
  - se outro dos 4 já o começou, aparece «A ser contado por Rita F.», sem botão de
    começar. A forma de passar o jogo a outra pessoa vem na Fase C.
- O formato vem do mix (tabela abaixo). Quem conta não escolhe.
- No fim do jogo (pelas regras, ou «Terminar» num jogo por tempo) o resultado é
  gravado. Se não houver rede, fica em fila no relógio e vai quando houver. O ecrã
  de fim mostra «Gravado no mix ✓» ou «A enviar…».
- Desfazer depois do fim: enquanto o mix estiver a decorrer, regrava o jogo como
  hoje faria o admin.

### Na app (web e iOS)

- O placar «A decorrer agora» (`LiveBoard`) e a página do mix (`GameDetails`), em
  cada campo contado no relógio, mostram os jogos e, ao lado, os pontos do jogo em
  curso, por exemplo «4-3 · 30-15». Têm um pequeno ícone de relógio que indica que o
  jogo está a ser contado em direto.
- A atualização é por Realtime, sem recarregar. O `GameDetails` já subscreve
  `matches` (`src/pages/GameDetails.jsx:431`). A linha «A decorrer agora» da Home
  hoje carrega uma só vez e, com a folha aberta, passa a subscrever também.
- Os campos sem relógio ficam como hoje.
- Se o relógio deixar de mandar pontos durante mais de 3 minutos (minha escolha), o
  campo deixa de mostrar os pontos e fica só com os jogos.

## Formato do relógio a partir do mix

| `games.scoring_format` | Relógio |
|---|---|
| `melhor_3_sets` | `bestOf3` (o 3.º set: o que o mix já usa, `stb` se for super tie-break) |
| `melhor_2_sets` | `twoSetsSuperTieBreak` |
| `pro_set_9` | `proSet9` (desempate pelo `tiebreak_8_8`) |
| `pontos_simples` com `round_duration_minutes` | `endlessSet` (acaba com «Terminar» no fim da ronda) |
| `pontos_simples` sem tempo | `points` |

`deuce_mode` → `DeuceMode` (`ponto_de_ouro` → `golden`, os outros pelo nome).
Quem constrói confirma estes mapeamentos contra `src/lib/scoreRules.js` e o
`save_mix_match_result`. Qualquer combinação que não feche fica fora («Este mix
não dá para contar no relógio»), em vez de se adivinhar.

## Como funciona por dentro (minhas escolhas, para contestar)

### Conta no relógio

Hoje o relógio não tem conta. O iPhone (app Capacitor, já com sessão Supabase) passa
ao relógio a sessão (`access_token` + `refresh_token`) por `WCSession`
`updateApplicationContext` sempre que a sessão muda, e passa uma sessão vazia
quando se sai da conta. O relógio guarda-a no Keychain e renova o token sozinho
(`/auth/v1/token?grant_type=refresh_token`).

Atenção à rotação de refresh tokens: se o relógio e o iPhone renovarem o mesmo
refresh token, um deles fica sem sessão. Quem constrói tem de resolver isto, por
exemplo com uma sessão própria para o relógio, criada a partir do iPhone, ou com o
iPhone a ser o único a renovar e a mandar o token novo. A escolha fica para o
builder, mas tem de ficar documentada.

### O relógio fala diretamente com o Supabase

`URLSession` no relógio usa a internet do iPhone por Bluetooth, ou o Wi-Fi/LTE do
relógio. Assim os pontos não dependem de a app do iPhone estar aberta, nem de o
JavaScript correr em segundo plano. Sem SDK: chamadas REST às RPCs, com a chave
publicável (anon) e o token do utilizador.

### Base de dados (uma migração nova por fase; nada existente muda de forma)

Tabela nova `mix_live_scores`, uma linha por jogo do mix contado no relógio:

- `match_id` PK → `matches(id)` ON DELETE CASCADE
- `scorer_id` → `profiles(id)`: quem tem o jogo
- `started_at`, `updated_at`
- `seq` INTEGER: cresce a cada ponto, para ignorar envios fora de ordem
- `state` JSONB: o que o placar mostra (jogos do set atual, sets, pontos do jogo,
  `phase`, `serving`, `deuce` etc.). O formato é fixado pela Fase B e só cresce.
- `finished_at`

Leitura: as mesmas pessoas que podem ler o `matches` do jogo (reusar a função
auxiliar que já exista; não copiar outro `EXISTS` à mão, ver CLAUDE.md). Escrita:
**só por RPCs `SECURITY DEFINER`**, sem políticas de INSERT/UPDATE para clientes.

RPCs:

- `list_my_watch_mix_matches()`: os jogos de mixes `in_progress` hoje em que
  `auth.uid()` é um dos 4, com nomes, formato e quem os tem (`scorer_id`).
- `claim_mix_match(p_match_id)`: dá o jogo a `auth.uid()` se for um dos 4, se o mix
  estiver `in_progress`, se o jogo ainda não tiver resultado e se ninguém o tiver.
  Caso contrário dá erro (`not_player`, `taken`, `not_live`, `has_result`). Fica
  atómico com `INSERT … ON CONFLICT DO NOTHING` ou `SELECT … FOR UPDATE`.
- `push_mix_live_score(p_match_id, p_seq, p_state)` (Fase B): só o `scorer_id`; só
  aplica se `p_seq > seq`.
- Gravar o fim: o relógio chama `save_mix_match_result` (o mesmo caminho que se usa à
  mão, com as mesmas travas do #588). Para isso, essa RPC passa a aceitar também
  **quem é um dos 4 jogadores desse jogo e tem o jogo em `mix_live_scores`**, só com
  o mix `in_progress`. **Isto alarga quem pode gravar resultados de mix e tem de ser
  confirmado pelo Renato (ver «Para confirmar»).**
- `release_mix_match` / `take_over_mix_match` (Fase C).

Realtime: `mix_live_scores` entra na publicação `supabase_realtime`. Quem constrói
confirma que o Realtime respeita a RLS de leitura desta tabela.

### Compatibilidade

- Apps antigas não conhecem a tabela nova e continuam como hoje.
- O relógio só mostra «Jogos do mix» se a RPC existir. Se der 404 (migração por
  correr), esconde-se e não dá erro.
- `WatchGamePayload` (relógio → iPhone) não muda nesta parte. Um jogo de mix não é
  enviado também como jogo entre amigos, para não aparecer a dobrar em «Os meus
  números». O registo local no relógio continua.

## Fases (cada uma vai para dev e é testada antes da seguinte)

**Fase A: contar um jogo do mix no relógio e gravar no fim.**
Sessão do iPhone no relógio · `mix_live_scores` (só o pedido do jogo) ·
`list_my_watch_mix_matches` · `claim_mix_match` · alargar `save_mix_match_result` ·
ecrã «Jogos do mix» no relógio · formato a partir do mix · fila de envio no fim.
Teste: num mix de dev com 4 contas, um começa e os outros três veem o jogo
bloqueado; no fim, o resultado aparece no `GameDetails`.

**Fase B: ponto a ponto na app.**
`state`/`seq` + `push_mix_live_score` · relógio envia a cada ponto e no desfazer
(o último estado ganha, sem fila: se falhar, o próximo ponto corrige) · Realtime no
`LiveBoard` e no `GameDetails` · ícone do relógio · os 3 minutos sem sinal.
Teste: dois telemóveis a ver, um relógio a contar, e o placar acompanha em ≤ 2–3 s
com rede normal.

**Fase C: passar o jogo a outro relógio.**
Outro dos 4 toca em «Continuar a contar», confirma, e passa a ter o jogo a partir do
último `state` gravado. O primeiro relógio, no próximo envio, recebe `taken` e mostra
«Este jogo passou para Rui M.», e deixa de contar. Antes disto (só A e B), se o
relógio morrer, o admin mete o resultado à mão como hoje.

Cada fase traz a sua migração, que **tem de ser corrida à mão** no Supabase de dev
e, antes de ir para `main`, no de produção. O relógio precisa de build no Codemagic,
lançada à mão.

## Para confirmar (Renato)

1. **Qualquer um dos 4 jogadores passa a poder gravar o resultado do seu jogo de mix
   (com o mix a decorrer)**, mas só pelo relógio, depois de ficar com o jogo. Hoje só
   o admin e quem ele nomeou para marcar resultados o podem fazer.

## Minhas escolhas (podes mudar)

- O relógio fala diretamente com o Supabase, não pelo iPhone.
- 3 minutos sem pontos → o placar deixa de mostrar os pontos.
- Passar o jogo a outro relógio fica para a Fase C. Até lá, se o relógio de quem
  conta morrer, o resultado volta a ser metido à mão.
- Um jogo de mix não vai também para «Os meus números» como jogo entre amigos.
- Combinações de formato que não se mapeiam com certeza ficam fora, com aviso.

## O que fica para quem constrói

O formato exato do `state`, como renovar os tokens sem conflito com o iPhone, o nome
das RPCs, o desenho fino do ícone e dos pontos no `LiveBoard`, e a forma de mostrar
«A ser contado por…» no relógio (seguindo a spec de 26 out do protótipo).
