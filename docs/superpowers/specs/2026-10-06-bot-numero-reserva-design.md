# Robô: número de reserva automático e menos risco de ban — desenho

Data: 2026-10-06 · Pedido: Renato · Estado: proposta

## Porquê

A 3 out 2026 o WhatsApp baniu o número do robô (351931386496, `403 forbidden`
no login). O robô parou em todos os grupos, de todos os clubes, até se
emparelhar um número novo à mão (351923538245, commit `1f789f3`). Nesse dia
já saíram as menções em massa (`d6b1f75`) e o loop de reconexão no 403.

Queremos duas coisas:

1. **Continuidade** — se o número ativo cair, um 2.º número que já está nos
   grupos assume sozinho, em poucos minutos, sem ninguém mexer.
2. **Menos risco** — baixar a probabilidade de o número ser banido.

## O que a pesquisa diz (resumo)

- Não há forma de "desbanir" pelo código. Um ban só se resolve com «Pedir
  revisão» na app ou esperando o fim de um ban temporário. Insistir no login
  piora. Depois de um ban, o mesmo número/IP fica mais vigiado.
- A API oficial (Cloud API, Groups) só gere grupos criados por ela, com até 8
  participantes — não serve para os grupos dos clubes.
- Os sinais que mais pesam no nosso caso: IP de datacenter (EC2) que não bate
  com um número português; número novo (primeiros ~10 dias); o mesmo texto e
  o mesmo link repetidos em vários grupos; atividade a qualquer hora.
- A nosso favor: só escrevemos em grupos onde o robô já está e as pessoas
  respondem («In»/«Out») — taxa de resposta alta.
- `baileys-antiban` (npm): não se instala. Um só autor, 40 versões no npm para
  11 commits no GitHub, e recebe o socket (a sessão inteira). As ideias úteis
  fazem-se aqui em ~150 linhas (secção «Comportamento»).

## Desenho

### 1. Dois processos, um só ativo (lease na BD)

- Dois processos do robô, cada um com o seu número e a sua pasta de sessão:
  `BOT_INSTANCE=principal` e `BOT_INSTANCE=reserva`. Os dois correm no
  **mesmo EC2**, em dois contentores Docker (decisão do Renato, 6 out). Risco
  aceite: se o WhatsApp marcar o IP do servidor, os dois podem cair juntos —
  nesse caso a reserva muda de máquina, sem mudar código (ver
  «Infraestrutura»).
- Os dois números estão em todos os grupos. Os dois ficam ligados ao
  WhatsApp. **Só o que tem o lease fala**: responde a comandos, publica,
  lembra, arranca mixes. O outro fica calado (recebe as mensagens e ignora).
- Lease numa tabela nova `bot_lease` (uma linha por ambiente). O ativo
  renova a cada 20 s com validade de 90 s. O calado tenta reclamar a cada
  20 s; só consegue se o lease expirou.
- **Saída imediata**: ao receber 403 (ban) ou `loggedOut`, o ativo liberta
  o lease na hora — a reserva assume em ≤ 20 s em vez de esperar 90 s.
- **Sem "voltar atrás" automático**: quem assumiu fica ativo até cair. Evita
  trocas repetidas (flapping). Voltar ao principal é uma ação manual (SQL de
  uma linha, documentado).
- **Split-brain**: o ativo deixa de enviar assim que a SUA validade local
  passa (hora da última renovação bem-sucedida + 90 s − margem de 10 s),
  mesmo sem conseguir falar com a BD. Assim nunca há dois a falar ao mesmo
  tempo, mesmo com a BD em baixo.

### 2. O que muda no robô

- `wa.js`: `sendText`/`sendReaction` não enviam se o processo não for o ativo
  (rede de segurança; regista um aviso).
- `index.js`: as mensagens de grupo só entram na fila de comandos se o
  processo for o ativo. As mensagens privadas com código de confirmação do
  número (`verify.js`) são tratadas pelos DOIS — não enviam nada, só gravam
  na BD, e assim o código funciona mande-se a qual número se mandar.
- Tarefas agendadas (`sync`, `reminders`, `autostart`, `mixNotices`,
  `voucherNotices`): cada ciclo começa por `if (!isActive()) return`. O
  `autostart` mexe na BD (forma duplas) — não pode correr nos dois.
- Ao ficar ativo: `primeGroupHashes()` outra vez (regista os cartões que já
  estão nos grupos, sem os reenviar — não há rajada na troca) e uma mensagem
  curta por grupo: «🤖 O robô passou a responder por este número. Continua
  tudo igual: *In*, *Out* e *mix*.» — espaçada pelo limitador.
- Estado em memória (perguntas pendentes, pedidos de dupla, IDs dos cartões
  para respostas citadas) perde-se na troca. Aceite: é o mesmo que um
  reinício hoje. Uma resposta citada a um cartão antigo, com só um mix
  aberto, continua a funcionar; com vários, o robô pergunta qual.

### 3. O número que a app mostra

`src/lib/contacts.js` tem o número fixo (usado no «Enviar ao robô» da
confirmação do número). Passa a vir de um RPC público
`get_active_bot_number()` (devolve só o número de quem tem o lease válido),
com o número fixo atual como recurso se o RPC falhar. Como os dois processos
tratam os códigos, um link desatualizado continua a funcionar enquanto esse
número estiver vivo.

### 4. Comportamento (menos risco)

Num módulo novo `whatsapp-bot/src/sendGuard.js`, à volta de todo o envio:

- **Limite global**: no máximo 30 mensagens/hora e um teto diário
  (`BOT_DAILY_CAP`, por defeito 200; 60 nos primeiros 10 dias de um número
  novo — `BOT_NUMBER_SINCE=2026-10-03`). Acima do limite, as publicações
  agendadas esperam na fila; respostas a comandos («In», «Out», «mix») passam
  sempre (foram pedidas por uma pessoa).
- **Espaço entre envios**: 1,5–4 s aleatórios entre mensagens seguidas (para
  grupos diferentes inclusive).
- **Arranque/reconexão suave**: nos primeiros 60 s depois de ligar, no máximo
  uma mensagem a cada 6 s.
- **Horas calmas**: entre as 00:00 e as 07:30 (Lisboa) as publicações
  agendadas e lembretes esperam pelas 07:30; respostas a comandos passam.
- **Menos repetição**: o link `alinho.pt` só aparece nas mensagens onde é
  preciso (convidados a registar-se), não em todos os cartões. Rever
  `locales.js` e `roster.js`.

### 5. Alertas

`SLACK_ALERT_WEBHOOK_URL` (opcional). Mensagem no Slack quando: há 403/ban,
`loggedOut`, a reserva assume, nenhum processo tem o lease há > 5 min. Sem a
variável, só log.

## Infraestrutura e operação (não é código)

- **Número de reserva**: cartão SIM físico português (não VoIP), num
  telemóvel real, WhatsApp normal (não Business necessariamente), com nome
  «Alinho 🤖» e foto. Uso humano leve durante 7–10 dias antes de emparelhar
  (algumas conversas com a equipa, receber e responder).
- **Entrar nos grupos**: o admin de cada grupo adiciona o número de reserva.
  Avisar no grupo que é o número de reserva do robô (evita denúncias de um
  número desconhecido).
- **Onde corre a reserva**: no mesmo EC2 do principal, num 2.º contentor
  (`alinho-wa-bot-reserva`) com a sua própria pasta de sessão. Grátis e sem
  ninguém a manter uma máquina em casa. Cobre o caso mais provável (ban de um
  número de cada vez, como a 3 out). Se um dia caírem os dois juntos (IP do
  servidor marcado), a reserva passa para outra máquina — idealmente com IP
  residencial português —, só mudando onde o contentor corre.
- **O principal**: idealmente também sair do EC2 para um IP residencial PT a
  prazo. Fora deste trabalho; registar como decisão pendente.
- **Número banido (931…)**: pedir revisão na app. Se voltar, pode ser a
  próxima reserva — depois de aquecer outra vez.

## Base de dados

Migração nova `supabase/migration_bot_lease.sql`:

- `bot_lease(pool TEXT PK, holder TEXT, phone TEXT, renewed_at, expires_at)`,
  RLS ligada sem políticas (só o service role).
- `claim_bot_lease(p_pool, p_holder, p_phone, p_ttl_seconds) → expires_at|null`
  — atómico: `INSERT … ON CONFLICT (pool) DO UPDATE … WHERE holder = p_holder
  OR expires_at < now()`. Só `service_role`.
- `release_bot_lease(p_pool, p_holder)` — só `service_role`.
- `get_active_bot_number(p_pool default 'prod') → text` — `SECURITY DEFINER`,
  só o número, só se `expires_at > now()`. `anon` + `authenticated` (o número
  do robô já é público).

Tem de ser corrida no Supabase de produção antes de o robô novo arrancar lá
— o robô, sem a tabela, fica sempre ativo (comportamento de hoje) e regista
um aviso, para o deploy não partir nada.

## Testes

- Lease (unitário, com relógio falso): só um ativo; o calado assume quando o
  lease expira; liberta no 403; sem BD, o ativo cala-se ao fim da validade
  local; sem flapping quando o principal volta.
- `sendGuard`: limite por hora/dia, prioridade das respostas, horas calmas,
  rampa depois de ligar.
- `index`/tarefas: nada sai nem mexe na BD quando `isActive()` é falso.
- Manual em dev: dois processos com dois números de teste num grupo de QA;
  matar o ativo → a reserva assume e anuncia; voltar a ligar o principal →
  fica calado.

## Fora de âmbito

- Mais de dois números / um número por clube.
- Mudar o principal para fora do EC2.
- API oficial do WhatsApp.
