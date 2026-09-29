# Ranking (rating / "nível") — como funciona e porquê

Modelo em vigor desde `supabase/migration_elo_simples.sql` (28 set 2026). A parte 1 é o que está implementado; a parte 2 é o raciocínio e as simulações que levaram a este modelo, para não se voltar a discutir do zero. Todo o cálculo vive no Postgres; o JavaScript só mostra (`src/lib/elo.js:1-8`).

---

## Parte 1 — O modelo, em 7 regras

1. **Um rating global por pessoa** (`profiles.rating`). Começa no nível escolhido à entrada: N1 1900 · N2 1700 · N3 1500 · N4 1300 · N5 1100 · N6 850 · Iniciante 600 (`supabase/migration_elo_entry_levels.sql:140-170`); 900 para quem não escolheu.
2. **Rating da dupla = média dos dois.** Esperado com a fórmula clássica: `E = 1 / (1 + 10^((R_adv − R_nós) / 400))`.
3. **K = 20 para toda a gente.** Quem tem menos de 12 jogos contados usa K = 40, e isso só mexe no rating dele: os outros três no jogo movem pelo K 20 deles.
4. **Cada um da dupla leva o mesmo.** Ganharam juntos, ganham o mesmo; perderam juntos, perdem o mesmo. Chão em 0, sem teto.
5. **Só conta vitória, derrota ou empate.** Sets, jogos e pontos só decidem quem ganhou.
6. **Nada mais mexe no rating.** Não há prémio por ganhar o mix, por noite perfeita, nem por ser campeão de torneio. Isso é assunto de XP e pontos de clube.
7. **Quando a tua dupla está 150 pontos acima da adversária, ganhar vale cada vez menos, até zero aos 250.** Perder custa o normal. Para subir, joga com gente do teu nível.

Por jogo: `delta = K × (S − E)`, com `S` = 1 / 0.5 / 0. A 2 casas decimais na base, arredondado a inteiro no ecrã.

### Exemplos

| Situação | Ratings [A1, A2, B1, B2] | Deltas |
| --- | --- | --- |
| Duplas iguais, A ganha | 1100, 1100, 1100, 1100 | +10, +10, −10, −10 |
| Idem, mas A1 tem menos de 12 jogos | 1100, 1100, 1100, 1100 | **+20**, +10, −10, −10 |
| Dupla desnivelada (1200 + 1000) vs 1100 + 1100, A ganha | 1200, 1000, 1100, 1100 | +10, +10, −10, −10 |
| Favoritos ganham (E = 0,76) | 1300, 1300, 1100, 1100 | +4.8, +4.8, −4.8, −4.8 |
| Azarões ganham (E = 0,24) | 1100, 1100, 1300, 1300 | +15.2, +15.2, −15.2, −15.2 |
| Lugar sem conta na dupla A | 1100, —, 1100, 1100 | +10, —, −10, −10 |
| A1 está 250 acima, mas a dupla só 100 (E = 0,64): normal | 1250, 950, 1000, 1000 | +7.2, +7.2, −7.2, −7.2 |
| Dupla 200 acima (E = 0,76): metade | 1300, 1100, 1000, 1000 | **+2.4**, **+2.4**, −4.8, −4.8 |
| Dupla 250 acima (E = 0,81): zero | 1300, 1200, 1000, 1000 | **0**, **0**, −3.8, −3.8 |
| Idem, mas perde: custa na mesma | 1300, 1200, 1000, 1000 | −16.2, −16.2, +16.2, +16.2 |

### Onde está no código

| Peça | Ficheiro |
| --- | --- |
| A conta de um jogo (`elo_jogo_deltas`) | `supabase/migration_elo_simples.sql` §1 |
| Ler os 4 ratings, aplicar, escrever (`apply_elo_pairing`) | idem §2 |
| Mix: jogos por ordem de ronda → `mix_player_stats` (`apply_mix_elo`) | idem §3 |
| Torneio: jogos por ordem → `tournament_player_stats` (`apply_tournament_elo`) | idem §4 |
| Amigos: `friend_match_apply_game` / `confirm_private_match` → `apply_elo_pairing` | `migration_amigos_sem_bloquear.sql:240-337`, `migration_private_match_draw.sql` |
| Grupo: `apply_group_match_ranking` / `reverse_group_match_ranking` | `migration_group_matches.sql:330-452` |
| Entrada (`complete_rating_onboarding`) | `migration_elo_entry_levels.sql:140-170` |
| Recalcular tudo por ordem de data (`recalcular_niveis`) | `supabase/recalcular_niveis.sql` |
| Níveis (bandas), "provisório", formatação | `src/lib/elo.js` |

### O que conta

| Evento | Conta? | Condição |
| --- | --- | --- |
| Mix de clube (todos os formatos) | sim | `games.ranked` (`migration_mix_ranked.sql:171-173`) |
| Jogo entre amigos | só se | `ranked_intent` ∧ sem lugar com nome-convidado ∧ os 4 aceitaram ∧ não é empate (`migration_amigos_sem_bloquear.sql:268-274`) |
| Jogo dentro de um grupo | sim | `group_matches.ranked` |
| Torneio | sim | exceto `tournaments.is_test` |
| Aulas | não | — |

- Lugar sem conta (convidado por nome): não entra na média, não recebe nada; os outros movem normalmente.
- Contas de teste (`is_test`) saem das listas de ranking, não do cálculo.
- Não há afinações por clube: `organizations.points_rules` mexe nos pontos de clube, nunca no rating.

### Ordem, correções e reversões

- Dentro de um mix: jogos por `round_number, created_at, id`, com ratings vivos jogo a jogo. Torneio: por `scheduled_at, created_at, id`.
- Correção pós-fecho de um mix (`migration_correct_finished_americano.sql:218-255`): reverte os deltas guardados e volta a correr; recusa se faltar delta a alguém, se houver evento posterior, ou se o mix não for ranked. **Bug conhecido:** não reverte `rating_games` (linhas 249-251), que volta a incrementar ao reaplicar. Com o K 40 até aos 12 jogos, isto pode fechar a janela de alguém mais cedo. Cartão por abrir.
- Reversões que existem: grupo (`reverse_group_match_ranking`) e torneio (`undo_tournament_elo`). Não há reversão para mix apagado nem amigos apagado; o `recalcular_niveis` resolve à mão.
- `recalcular_niveis(FALSE)` mostra sem gravar; `(TRUE)` grava. Já não exige soma zero (os novatos a K 40 não são pagos por ninguém).

### O que deriva do rating

- Nível mostrado: ≥ 1800 → 1, ≥ 1600 → 2, ≥ 1400 → 3, ≥ 1200 → 4, ≥ 1000 → 5, ≥ 700 → 6, < 700 Iniciante; prefixo M/F, N sem género (`src/lib/elo.js`). "Provisório" (`~902`, selo NOVO) até 12 jogos — o mesmo limiar do K 40.
- Rankings global e por clube ordenam pelo mesmo `profiles.rating`; só quem já jogou tem lugar (`src/lib/rankingScales.js`).
- Duplas do mix: `formDuplas` ordena por rating e evita repetir parceiro dos últimos 4 mixes (`src/lib/mixLogic.js`, `whatsapp-bot/src/autostart.js`). Seeds de torneio = soma dos dois ratings.
- Etiquetas de evento (M4, MX3…) limitam quem se inscreve; nunca escrevem o rating.

---

## Parte 2 — Porquê este modelo (o raciocínio)

Entre 25 ago e 24 set o motor acumulou regras: K por escada (40/30/20), repartição 35/65 dentro da dupla, escudo de parceiro, prémio da noite (+1 %, +0,5 % noite perfeita) pago por quem perdia contra o vencedor ponderado pela surpresa, trava de domínio, soma zero forçada, meia-conta para convidado. Cada uma tinha uma razão; juntas, ninguém as conseguia explicar a um jogador, e as simulações abaixo mostram que, ao ritmo real do piloto, faziam o ranking pior.

### O ritmo real: 1 mix por semana, 4 jogos

Tudo o que se segue foi simulado por Monte Carlo (`supabase/ensaio_elo_monte_carlo.py`): 50 jogadores com nível real entre 850 e 1200, nível declarado N5 ou N6 com 25 % a declararem-se acima, duplas formadas por rating como o `formDuplas`, 40 repetições. É simulação, não produção; serve para ordens de grandeza.

**1. A 3 meses, o motor antigo piorava o ranking.** Erro médio (rating − nível real): 71 no início → **78** com o modelo #440 → 69 sem prémio → **64** com K 20 puro. Pessoas com o nível certo: 83 % no início → 72 % (#440) → 83 % (K 20). Pessoas que mudavam de nível em 3 meses sem o nível real ter mudado: **24 %** (#440) vs 3 % (K 20). (O modelo simples dá 70 / 78 % / 14 % neste ensaio porque os 50 começam todos com 0 jogos e passam os 3 primeiros mixes a K 40; em regime normal só os recém-chegados estão nessa janela — ver o ponto 8.)

**2. O prémio da noite era o maior estrago.** Sozinho subia o erro de 69 para 78 e quase dobrava as mudanças de nível (13 % → 24 %). +1 % de 1200 = 12 pontos, o mesmo que 1–2 vitórias; era "quem ganha, ganha mais" em cima do Elo.

**3. A repartição 35/65 não fazia diferença mensurável** (erro 73 vs 74). Custava a explicar e dava a sensação de castigar quem carrega a dupla. Fora.

**4. Subir o K não ajuda; com muitos jogos, estraga.** Escadas 40/30/20, 40/30, 50/35/25 e K 30 fixo: a 2 jogos por semana empatam (erro 101–109 ao fim de um ano); a 8 jogos por semana, K alto sobe o erro de 106 para 128–142 e a oscilação semanal de 22 para 33 pontos. K 120 nos primeiros 8–12 jogos **piora** os novos (71 → 90–108) e, no modelo de soma zero, contamina os veteranos (40 → 54), porque o K do jogo era a média dos quatro.

**5. Não se estabiliza um rating a pares em 8 ou 12 jogos, com nenhum K.** O erro padrão da estimativa é ≈ `350 / √n` em singulares e o dobro a pares (a média da dupla dilui cada um): ±245 com 8 jogos, ±200 com 12, ±115 com 37, ±70 com 100. O nível declarado (80 % de acertos) é melhor estimativa do que 8 jogos.

**6. Erros grosseiros de declaração corrigem-se numa época, não em semanas.** Com 1 mix × 4 jogos por semana, jogando só com M6, no modelo simples:
- declarou M3 (1500), é M6 (850): chega a M6 em **24 semanas** (mediana). Aos 3 meses já é M5.
- declarou M6 (850), é M4 (1300): chega a M4 em **27 semanas**. Passa a M5 ao 1.º mês e fica meses a ganhar tudo em mixes M6.
- K 40 nos primeiros 12 jogos poupa 4 semanas face a K 20 puro (28 → 24); K 60 × 8 poupa 5, mas mais do que dobra a inflação (+18 → +43 por 10 novos) e faz os bem declarados oscilar 65 pontos em 3 meses (vs 52 com K 40, 41 sem regra). K 120 é lotaria: +107 de inflação e ±98 de oscilação.

**7. Quem ganha sempre sobe sempre — daí a regra 7.** Alguém a começar em 850 que ganhe todos os jogos no campo de cima (adversários 950–1050) fica em ≈ 1250 aos 2 meses, ≈ 1580 aos 6, ≈ 1820 ao fim de um ano e ≈ 2220 aos três, sem teto. A causa é a média da dupla: um 1750 com parceiro 950 é uma dupla de 1350 contra 1000, E = 0,85, e cada vitória ainda vale +3, quatro vezes por semana; em singulares valeria +0,3. O Elo só estabiliza quando a pessoa perde, e ele não perde.

A primeira versão da regra (28 set) olhava ao **indivíduo**: 200 acima da dupla adversária, ganho 0. No mix de 28 set deu Renato −2 e Duarte +10 pelos mesmos 4 jogos, e cortou uma vitória que o esperado da dupla dava a 64 %. Contradizia a regra 4 e castigava o forte por ter parceiro fraco. A 29 set passou a olhar à **dupla**, com rampa: a partir de 150 acima da média adversária o ganho desce, até 0 aos 250. Os dois levam sempre o mesmo e nunca se corta um jogo que o Elo dava como disputado. O preço: como o parceiro fraco dilui a média, a trava chega mais tarde (invicto do M6 estabiliza em ≈ 1550 aos 2 anos, contra 1250 na versão individual e 2220 sem regra). O Ruben escolheu 150→250 em vez de 200→300 (≈ 1650) para a trava chegar mais cedo. Num clube normal, onde nenhuma dupla está 150 acima da outra, a regra não muda nada.

**8. Proteger os veteranos de um novato mal declarado.** Com K 20 e sem prémio, o dano já é limitado: ±20 por jogo, o novato entra em 1–2 dos 4 jogos por noite, ±10 a ±30 acumulados nos 12 jogos dele. Regras tipo FIDE ("jogos contra provisórios contam menos para os classificados") ganhavam 0–4 pontos de erro. O K 40 só para o próprio dá a correção mais rápida sem tocar em ninguém: num clube de 40 veteranos com 10 novos (30 % mal declarados), o erro dos veteranos fica em 49–50 com qualquer K do novato, e o dos novos passa de 167 (K 20) para 158 (K 40 × 12). Onde o novato mal declarado faz mesmo mal é no campo em que cai, não nos pontos.

### Comparação com o Elo clássico e o chess.com

O núcleo por jogo é Elo de manual: esperado com divisor 400, `K × (S − E)`, só o resultado conta, K maior para novos (FIDE: 40 até 30 partidas, 20 depois). As diferenças são as inevitáveis do 2v2 (média da dupla, ambos levam o mesmo). O chess.com usa Glicko (incerteza por jogador, que cresce com a inatividade); aplicado ao padel com 4 jogos por semana daria o mesmo que "K alto para novos", e a simulação mostra que isso não ajuda. Se um dia se quiser tratar a inatividade, é aí que o Glicko entra; não no arranque.

### O que ficou de fora, de propósito

- Admin corrigir o nível de entrada nos primeiros jogos (resolve o erro grosseiro numa noite; adiado por decisão do Ruben, 28 set).
- Regras de proteção dos classificados contra provisórios.
- Decaimento por inatividade.
- Recalcular o histórico: `recalcular_niveis(TRUE)` faz isso quando for decidido.

### Divergências que ainda existem no repositório

1. `rating_games` não é revertido na correção pós-fecho (ver acima). Cartão por abrir.
2. O troféu "calibrado" continua nos 8 jogos (`migration_trophies.sql:252`); é um marco, não o cálculo.
3. `ensaio_recalcular_niveis.sql` foi gerado a partir do #440 e ainda tem a asserção de soma zero; regenerar se voltar a ser preciso.
4. Os specs de 25 ago, 8 set e 15 set e `migration_ranking_soma_zero.sql` descrevem os modelos anteriores; são registos históricos e ficam como estão.
