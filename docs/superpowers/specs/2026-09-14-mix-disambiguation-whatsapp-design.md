# Desambiguação de mixes no WhatsApp (2+ mixes abertos ao mesmo tempo) — design

Data: 2026-09-14. Decisão de Francisco, a partir de um caso real vivido por ele próprio (print da mensagem colada na conversa). Contributo do Ruben: comando de listagem à parte, combinar identificadores na mesma frase, e usar o nível do mix como identificador.

## O problema

Quando há mais do que um mix aberto ao mesmo tempo no mesmo grupo de WhatsApp, o bot (`whatsapp-bot/src/roster.js` + `commands.js`) hoje:

1. Manda **uma única mensagem gigante** com os dois (ou mais) mixes colados um a seguir ao outro, separados só por uma linha de travessões — obriga a abrir/expandir a mensagem toda para ver qualquer um dos dois.
2. Pede para escrever **`In 7291`** — um código de 4 dígitos, aleatório, permanente, sem relação nenhuma com o mix (`games.short_code`, `migration_mix_short_codes.sql`) — para dizer a qual dos mixes a pessoa se refere. Difícil de decorar, fácil de trocar, e obriga a fazer scroll até ao código no meio da mensagem gigante do ponto 1.

3. **Bug confirmado no código** (`commands.js`, `parseCommand`): a palavra e o código só são reconhecidos com um espaço a separar os dois — `/^(.+) (\d{4})$/`. Alguém escreveu tudo junto (ex. `in7291`, sem espaço) e o bot não reconheceu nada — `normalized` não bate certo nem com as palavras exatas (`in`, `alinho`, etc.) nem com a expressão regular, que exige o espaço. A mensagem foi ignorada em silêncio, como qualquer conversa normal do grupo.

Confirmado a verificar o código: `short_code` só é usado para esta desambiguação (`commands.js`, `formatMixLine`) — não aparece em mais nenhum comando nem em Admin.jsx, por isso pode mudar de forma livremente sem partir outra coisa.

## O que muda

### 1. Uma mensagem por mix, não uma mensagem só com todos colados

Cada mix aberto passa a ser a sua própria mensagem de WhatsApp (mantém o mesmo conteúdo/roster que já tem hoje). Deixa de haver uma mensagem "2 em 1" a precisar de scroll.

### 2. Responder (reply) à mensagem do mix = dizer a qual te referes

Se a pessoa usa a função nativa do WhatsApp para **responder** a uma mensagem específica de um mix e escreve `in` (ou `out`), o bot lê o ID da mensagem respondida (o WhatsApp manda sempre essa referência, mesmo fora da API oficial de negócio — Baileys expõe isto no `contextInfo`/`stanzaId` da mensagem recebida) e já sabe exatamente a qual mix se refere. Sem código nenhum.

Isto só é possível por causa do ponto 1 — com tudo numa mensagem só não há "a mensagem daquele mix" para responder.

### 3. Código simplificado: 01, 02... por conjunto de mixes abertos

Deixa de se usar o `short_code` de 4 dígitos (aleatório, permanente, global) para desambiguação. Passa a haver uma numeração simples — **01, 02, 03...** — atribuída na hora, só à lista de mixes abertos NAQUELE grupo NAQUELE momento (não persistente, não global). `short_code` pode manter-se a existir na base de dados para outros fins futuros, mas deixa de ser o que aparece nas mensagens do bot para este efeito.

### 4. Várias formas válidas de dizer a qual te referes

Além do reply (ponto 2) e do número (ponto 3), o bot também aceita, tudo no mesmo comando (`Alinho 01`, `In 01`, `In segunda`, `in quinta`, uma data, uma hora, ou um pedaço do local):

- O número da lista (`01`, `02`)
- O dia da semana (`segunda`, `quinta`) — **calculado a partir da data do mix** (`mix.date`), não à procura da palavra no título. "Segunda" bate certo com qualquer mix cujo dia da semana seja segunda-feira, esteja isso escrito no título ou não (confirmado por Francisco, 14 set 2026).
- A data
- A hora
- Um pedaço do local
- **O nível do mix** (`m4`, `m5`...) — campo `games.level`, já usado hoje em `MIX_LEVELS` (GerirClube.jsx) (ideia do Ruben, 14 set 2026).

O bot testa o texto a seguir a `in`/`out`/`alinho` contra estes campos de cada mix aberto. Se bater certo com **exatamente um**, resolve direto. Se bater com **dois ou mais** (ex.: dois mixes à segunda-feira, horas diferentes, e a pessoa só escreveu "segunda"), o bot não adivinha — volta a perguntar, mostrando a lista outra vez para a pessoa ser mais específica.

**Combinar vários identificadores na mesma frase** (Ruben, 14 set 2026 — "a semântica é melhor"): não é só um identificador de cada vez. `in terça 19h`, `in segunda 21`, `in segunda m4` são todos válidos — o bot procura, no texto a seguir à palavra de ação, todos os identificadores reconhecíveis (dia, hora, nível, pedaço do local, etc.) e filtra os mixes abertos por TODOS os que encontrar em conjunto, não só o primeiro. Isto resolve por si só casos que um identificador sozinho não resolve — ex.: dois mixes à segunda-feira, um M4 e outro M5, ficam ambíguos com só "segunda" mas resolvem-se com "segunda m4".

### 4a. Funciona com ou sem espaço entre a palavra e o identificador

O `parseCommand` atual (ver "O problema", ponto 3) só reconhece o identificador com um espaço a separar (`in 7291`). A correção cobre as duas formas — `in 01` e `in01`, `alinho segunda` e `alinhosegunda` — em vez de depender de as pessoas acertarem no espaço.

### 4b. Comando `mix` — só para ver a lista, sem tentar entrar em nada

Ideia do Ruben, 14 set 2026: um comando novo, à parte de `in`/`out`, só para consultar. Escreves `mix` e o bot responde com quantos mixes há abertos e uma lista curta (dia + identificador de cada um), sem inscrever em nada — só para saberes o que existe antes de decidires. Útil quando nem sabes ao certo quantos mixes estão abertos naquele momento.

### 5. `in` sozinho, sem mais nada, com 2+ mixes abertos

Se a pessoa escrever só `in` (sem número, dia, hora, etc.) e houver 2+ mixes abertos, o bot pergunta a qual se refere — mostra a lista numerada (01, 02...) e pede para responder com um dos identificadores do ponto 4.

### 6. Já estou inscrito num, e escrevo `in` outra vez → entra no que falta, sem pedir nada

Se a pessoa já está confirmada num dos mixes abertos e sobra exatamente UM outro mix aberto onde ainda não está, um novo `in` (sozinho, sem identificador) é interpretado como "quero entrar nesse também" — o bot inscreve direto, sem pedir código nem confirmação. Só volta a perguntar se sobrar mais do que um mix onde a pessoa ainda não está.

## Casos-limite / por decidir

- **Confirmação da ação** (ideia levantada, ainda por fechar): depois de resolver a qual mix a pessoa se refere (por reply, número, dia, hora, etc.), o bot pode responder logo com uma confirmação explícita — "✅ Inscrito no Mix de Segunda-feira, 21:00" — para a pessoa perceber de imediato se acertou ou se quer corrigir com `out`. A decidir se isto se aplica sempre ou só nos casos resolvidos por texto (não por reply, que já é bastante inequívoco por si só).
- **Reply a uma mensagem de um mix já fechado/cancelado**: o bot deve responder com uma mensagem clara em vez de falhar em silêncio — comportamento exato ainda por definir.
- **Correspondência por dia/hora/local ambígua entre grupos diferentes**: não deve acontecer na prática (cada grupo de WhatsApp mapeia para um único clube/organização), mas o teste "bateu com 2+, pergunta outra vez" cobre isto de qualquer forma.

## Fora de âmbito nesta versão (registado, não construído agora)

- **Lista tocável nativa do WhatsApp** (interactive list message) — tecnicamente mais simples para quem usa o WhatsApp (tocar em vez de escrever), mas por confirmar se o Baileys (biblioteca não-oficial que o bot usa, ver `whatsapp-bot/README.md`) suporta isto de forma fiável fora da API oficial de negócio. Não avançar sem confirmar primeiro.
- **Conversa com estado** (o bot pergunta, espera a próxima mensagem da mesma pessoa como resposta à pergunta, sem repetir `in`) — mais natural, mas exige guardar "esta pessoa está a meio de uma pergunta" nalgum sítio (memória ou tabela nova, com expiração). Rejeitado por agora a favor das heurísticas mais simples acima (reply nativo, correspondência por texto, auto-resolução quando só falta um).

## Ficheiros

- `whatsapp-bot/src/roster.js` — construção das mensagens (`buildMixBlock`, hoje concatena todos os mixes abertos numa string só).
- `whatsapp-bot/src/commands.js` — parsing de `in`/`out`/`alinho` e a lógica de desambiguação (`openMixes`, `formatMixLine`, código por `short_code`).
- `app/supabase/migration_mix_short_codes.sql` — origem do `short_code` de 4 dígitos atual; não usado em mais nenhum comando, seguro para deixar de ser o identificador principal desta funcionalidade.
- Sem migração nova prevista — a numeração 01/02 é calculada na hora a partir da lista de mixes abertos, não precisa de nova coluna.
- Muda só o bot de WhatsApp — sem auto-deploy, precisa do Renato para publicar manualmente depois de implementado.
