# Jogos em aberto via WhatsApp — design

Data: 2026-09-16. Decisão de Renato. Resolve o caso em aberto "fluxo de inscrição ainda não definido: pela app, igual ao mix? Também via WhatsApp?" deixado em `2026-09-10-jogo-em-aberto-clube-design.md` — a resposta é: sim, via WhatsApp, respondendo com a hora do horário pretendido.

## O que é

O admin do clube marca, num formulário rápido do backoffice, horários com disponibilidade de campo (ex: 12:00-13:30, 13:00-14:30, 13:30-15:00) e publica-os de uma vez. O bot envia uma única mensagem combinada ao grupo de WhatsApp do clube listando esses horários. Qualquer pessoa no grupo responde com a hora pretendida (ex: "in 18") para ocupar uma vaga — sem precisar de abrir a app. Quando um horário chega a 4/4, esse campo está "fechado".

Tal como decidido na spec anterior, um jogo em aberto **funciona como um mix normal** assim que existe (ranked por defeito com toggle do admin, participação cancelável até haver resultado, correção de resultado por unanimidade, exceto se inserido pelo admin) — o que muda aqui é só a forma como é criado em lote e como se entra (WhatsApp, por hora, em vez de abrir a app).

## Modelo de dados

Sem tabelas novas — reaproveita `games` na íntegra:

- `games.origin TEXT NOT NULL DEFAULT 'admin'` — `'admin'` para mixes normais (comportamento atual, sem alteração), `'open_slot'` para jogos em aberto.
- `games.open_batch_id UUID` (nullable, só usado quando `origin = 'open_slot'`) — todas as linhas criadas no mesmo "Publicar no WhatsApp" partilham o mesmo `open_batch_id`, para o bot saber que pertencem à mesma mensagem combinada.
- Cada linha do formulário rápido gera uma `games` row com `num_courts = 1`, `max_players = 4`, hora/data da linha, e os defaults do lote (preço por jogador, formato, restrição de género, ranked on/off). `level` (restrição de nível) começa por omisso.
- Trigger novo: ao primeiro `participants` insert numa `games` row com `origin = 'open_slot'`, se esse jogador tiver nível definido no perfil, define `games.level` com esse valor. Não bloqueia entradas seguintes de outros níveis — é só informativo, mostrado na mensagem.
- Tudo o resto (trigger `check_game_full`, `promote_waitlist`, resultados, Elo/ranking) fica exatamente como está — um jogo em aberto cheio é, para todos os efeitos, um mix.

Migração: `supabase/migration_open_slots.sql` (nome final a decidir na fase de implementação). **Tem de ser corrida manualmente no Supabase SQL Editor antes do código que depende dela ir para `main`** — uma migração no repo não é uma migração aplicada.

## Backoffice (Gerir do clube)

- Novo separador **"Jogos Abertos"** em `GerirClube.jsx`, distinto da lista de Mixes.
- A lista normal de Mixes filtra `origin = 'admin'` — jogos em aberto nunca aparecem lá, mesmo depois de fechados a 4/4 (decisão explícita: ficam sempre só no separador Jogos Abertos, incluindo depois de terem resultado).
- Formulário rápido de publicação: escolher a data, definir uma vez os defaults do lote (preço por jogador, formato, restrição de género, ranked on/off — nível fica sempre por definir), depois adicionar N linhas "hora início – hora fim". Um botão "Publicar no WhatsApp" insere as N `games` rows de uma vez, todas com o mesmo `open_batch_id`.
- O separador Jogos Abertos mostra o estado de cada horário publicado (0/4, 2/4, fechado a 4/4, cancelado) em tempo real. Cancelar um horário por preencher reaproveita o fluxo existente de cancelar jogo, incluindo o `confirm()` de segurança.

## WhatsApp bot

- **Publicação**: a subscrição Realtime já existente em `sync.js` (`INSERT ON games`) deteta as novas rows; para `origin = 'open_slot'` o bot agrupa por `open_batch_id` e envia **uma mensagem combinada** por lote, não uma por horário.
- **Formato compacto** — sem os círculos vazios de vagas por preencher (correção pedida por Renato depois de ver o print de referência, para não ficar uma mensagem gigante):
  ```
  🟡 JOGOS ABERTOS — Hoje (Terça)

  🕐 12:00-13:30  👥 0/4 jogadores
  🕐 13:00-14:30  👥 1/4 jogadores (Nível: M4)
     - João
  🕐 13:30-15:00  👥 0/4 jogadores
  ```
  Só aparecem nomes/ícones de quem já entrou — nunca placeholders de vagas vazias.
- **Entrar**: responder ao texto com a hora do horário pretendido (ex: "in 18", "in 18h", "in 18:00" → resolve para o horário cujo início é 18:00). O bot resolve contra os horários ainda abertos (não cheios) desse lote/clube. Se houver exatamente um horário em aberto no clube nesse momento, "In" sozinho continua a funcionar (reaproveita o auto-resolve já existente para mix único aberto). Hora ambígua ou sem correspondência → o bot responde a pedir para especificar a hora.
- **Sair**: responder "Out" com a mesma lógica de resolução por hora.
- **Reposição da mensagem**: qualquer alteração a um `participants` de um jogo do lote (entrada, saída, jogo a fechar) faz o bot re-renderizar e editar a mensagem combinada inteira (mesmo mecanismo de `{hash, messageId}` já usado para mixes, mas chaveado por `open_batch_id` em vez de por `game_id`).
- **Nível dinâmico**: aparece como `(Nível: M4)` assim que o primeiro jogador com nível definido entra nesse horário. Se a pessoa não estiver na app (sem perfil/nível), não aparece nada — informativo, nunca bloqueia.

## Casos-limite / por decidir (não bloqueia esta versão)

- Entrada em dupla (par) via WhatsApp usa o mesmo mecanismo que os mixes normais já suportam hoje — não é alterado nem redesenhado aqui.
- Duas linhas do mesmo lote com a mesma hora de início (ex: dois campos livres às 18:00 em simultâneo) — "in 18" ficaria ambíguo entre as duas. Não tratado nesta versão; assume-se que o admin não publica horários de início duplicados no mesmo lote.
- Distinção visual "campo de última hora" (urgência) do print de referência — fica de fora desta versão, todos os horários publicados são iguais.

## Futuro (registar, não construir agora)

Herdado da spec anterior: quando existir booking real de campos, o sistema pode detetar horários livres e publicar jogos em aberto automaticamente, sem o admin preencher o formulário à mão.

## Ficheiros

- Supersede/resolve o caso em aberto de fluxo de inscrição em `2026-09-10-jogo-em-aberto-clube-design.md` — as restantes regras dessa spec (ranked por defeito, correção por democracia, cancelamento até resultado) aplicam-se sem alteração.
- Trello: card a criar/ligar (referência #236 é da spec anterior — confirmar com o board se reaproveita esse cartão ou abre um novo).
