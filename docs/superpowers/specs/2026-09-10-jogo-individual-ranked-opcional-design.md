# Jogo individual entre amigos: ranked opcional com validação de todos — design

Data: 2026-09-10. Decisão de Francisco, confirmada pela equipa ("implementa como queres, depois muda-se se decidirmos"). Estende `migration_private_match_elo.sql` (2026-09-08) — não a substitui.

## Porquê

Jogadores fortes evitavam registar jogos amigáveis com amigos mais fracos por medo de perder Elo. A confirmação cruzada (8 set) já fechava parte do risco de batota (o criador deixou de poder confirmar sozinho); falta a parte do consentimento — ninguém devia ser obrigado a competir por pontos num jogo de lazer.

## Fluxo

1. Ao criar (ou registar retroativamente) o jogo, o criador escolhe uma intenção: ranked ou não. Marca também data (obrigatória), hora e local (opcionais), e procura qualquer jogador da app (amigo ou não) para os 4 lugares.
2. Cada um dos outros 3 jogadores recebe notificação e responde com um de 3 estados:
   - **Nunca abriu** — fica pendente, sem prazo de expiração (nunca ia contar de qualquer forma). Só param os lembretes ao fim de uns dias — não fecha nada.
   - **Abriu e aceitou** — conta como "sim" para o ponto 3.
   - **Abriu e não aceitou / rejeitou** — sai do registo: o nome/dados dessa pessoa desapenam do cartão para os outros participantes. Aplica-se **mesmo em jogos sem ranking** — a escolha de estar associado a um registo é sempre individual, independente de contar ou não para o Elo.
3. Só conta para o Elo se **todos os 4** aceitarem explicitamente o ranking. Aceitar ficar no registo e recusar o ranking são decisões separadas — dá para aceitar o primeiro e recusar o segundo (o jogo fica "amigável", visível, sem mexer no Elo). A decisão não pode depender do resultado já conhecido — daí a exigência de consentimento real em vez de só "quem ganhou decide".
4. Amigos sem conta na app podem ser registados por nome, mas nunca contam para ranking (não há com quem confirmar).

## Casos-limite

- **Correção de resultado**: já existe hoje *antes* de confirmado (qualquer um dos 4 pode reenviar, reinicia a confirmação — ver spec de 8 set). Corrigir *depois* de já confirmado/a contar para o Elo não existe — implicaria anular e reaplicar o delta já escrito. Fora de âmbito por agora, a confirmar com o Francisco se é mesmo preciso.
- **Modelo de jogo (pontos corridos vs. sets vs. sets + super tiebreak)**: já existe um padrão pronto a copiar — `2026-09-10-set-scoring-formats-design.md` (chegou a `dev` no mesmo dia), que resolve exatamente isto para mixes: `games.scoring_format` (pontos_simples / melhor_2_sets / melhor_3_sets / pro_set_9) + tabela `match_sets`. Falta só aplicar o mesmo padrão a `private_matches` — não é preciso desenhar do zero, é reaproveitar.
- **Kudos**: hoje só existe para mixes (`migration_kudos.sql`, 9 set — 1 kudos por mix finalizado, janela 48h, XP). Não existe ainda para jogos entre amigos — dar kudos aqui é trabalho novo, não uma extensão automática.
- **Não confundir com "jogo em aberto"** (lançado por um clube para preencher horários, funciona como um mix): tem regras diferentes e é uma funcionalidade à parte — ver `2026-09-10-jogo-em-aberto-clube-design.md`.

## Impacto técnico

Expande o modelo atual de confirmação (1 confirmador da equipa adversária, binário pending/confirmed) para aceitação individual por jogador — precisa de uma tabela nova de confirmações por participante (estado: nunca visto / aceitou-tudo / aceitou-sem-ranking / rejeitou), não é só um ajuste a `confirm_private_match`.

## Ficheiros

Trello: https://trello.com/c/UXSgKZcT/233-jogo-individual-ranked-opcional-com-valida%C3%A7%C3%A3o-de-todos-os-jogadores (Selected/Ready). Ainda por implementar — este documento é o design, não o código.
