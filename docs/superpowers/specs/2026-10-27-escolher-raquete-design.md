# Escolhe a tua raquete — recomendação de raquetes com IA

Data: 2026-10-27. Brainstorm com o Renato nesta conversa. Mockups (aprovados): `.superpowers/brainstorm/1067-1793113249/content/raquete-ecras-v2.html`.

## Porquê

Os jogadores perguntam uns aos outros que raquete comprar e escolhem pela marca ou pelo que o colega usa. O Renato quer
um questionário curto no perfil que, com as respostas do jogador, sugere **3 raquetes reais, à venda hoje, com foto,
preço e link para comprar**. A IA explica porque é que cada uma serve *a este jogador*.

## Objetivos

- No Perfil, um cartão «Escolhe a tua raquete» abre um questionário de **11 ecrãs**, uma pergunta por ecrã, ao estilo do registo.
- No fim, 3 raquetes: a melhor em destaque («A melhor para ti») e mais duas, cada uma com foto, nome, preço, specs,
  porque serve, prós e contras e «Ver na Street Padel ↗».
- O resultado fica guardado. Ao voltar, o cartão do perfil mostra «As tuas raquetes» com as 3 fotos. Dentro há
  «Refazer as perguntas».
- pt-PT primeiro, com en e es como o resto da app.

## Não-objetivos

- Links de afiliado e comissões. Os links são simples. Mais tarde pode haver uma loja parceira portuguesa: o código
  que monta o link deve ser **um sítio só**, para se poder trocar a loja ou acrescentar um parâmetro de afiliado.
- Histórico de resultados (só fica o último), comparar raquetes, notificações de preço, compra dentro da app.
- Mais lojas além da Street Padel nesta versão.

## Anti-objetivos (falha mesmo que funcione)

- **A IA inventar uma raquete, um link, um preço ou uma spec.** Só pode escolher de uma lista que lhe damos, e o
  servidor rejeita qualquer id que não esteja nessa lista. As specs mostradas vêm da descrição da loja. O que a loja
  não diz aparece como «não indicado», nunca como um valor estimado (regra do produto: nada inventado, ver `PRODUCT.md`).
- Recomendar uma raquete esgotada ou acima do orçamento. Isto é garantido pelo código, não pelo prompt.
- Empurrar a mais cara ou a mais «avançada» só por ter melhores specs. O prompt diz-o explicitamente (texto do Renato
  abaixo).
- Mostrar um preço de há semanas como se fosse de hoje.

## O questionário (decidido: 20 → 11 ecrãs)

Base: a lista do Renato (20 perguntas, em 5 blocos). Cortada com o acordo dele: o que o perfil já sabe não se pergunta,
e as perguntas sobrepostas juntam-se.

| # | Pergunta | Respostas | Da lista original |
|---|---|---|---|
| 1 | Quantas vezes jogas? | < 1×/semana · 1–2× · 3–4× · 5+× | 2 |
| 2 | Como descreves o teu jogo? | Defensivo e paciente · Equilibrado · Agressivo, a fechar pontos · Tático, colocação e efeito | 6 |
| 3 | Os teus pontos fortes (várias) | Remates e smashes · Voleios e ataque na rede · Bandejas e víboras · Defesa e globos · Toque, colocação e regularidade | 7 |
| 4 | O que te custa mais? | Gerar potência · Controlar bolas fortes · Defender bolas difíceis · Acertar no centro · Ser rápido na rede | 8 |
| 5 | Alguma dor ao jogar? (várias; «Não» exclui as outras) | Não · Cotovelo · Pulso · Ombro · Outra | 9 |
| 6 | Que sensação preferes? | Leve e macia · Equilibrada · Pesada e firme · Não sei | 10 + 11 |
| 7 | Acertas no centro? | Quase sempre · Muitas vezes · Muitas vezes fora do centro | 12 |
| 8 | O que queres mais? | Controlo · Equilíbrio controlo/potência · Potência · Conforto e perdão | 13 + 15 + 16 |
| 9 | Formato | Redonda (controlo) · Lágrima (equilíbrio) · Diamante (ataque) · Recomenda-me | 14 |
| 10 | Orçamento máximo | < 80 € · 80–150 € · 150–220 € · 220–300 € · 300 €+ | 17 |
| 11 | Marcas preferidas e raquete atual (opcional, «Saltar») | Bullpadel · Nox · Head · Adidas · Babolat · Outra · Sem preferência (várias) + texto livre «Que raquete usas e o que mudavas?» | 18 + 4 |

- **Do perfil, sem perguntar:** lado (`profiles.preferred_side`), mão dominante (`profiles.dominant_hand`) e nível. O
  nível é por clube (`memberships.level`): manda-se à IA o nível dos clubes do jogador, tal como está. Se faltar algum
  destes dados, simplesmente não vai.
- **Cortadas:** 3 e 19 (sobrepõem-se ao nível) e 20 (testar antes de comprar quase não muda a escolha).
- Os textos exatos dos ecrãs e das respostas ficam para o builder, curtos e em pt-PT (ver «Copy» em `DESIGN.md`).

## O resultado

Para cada uma das 3 raquetes (ficha completa ao abrir o cartão):
nome · foto · preço de hoje · formato · peso · balanço · dureza e materiais · ponto doce e perdão ·
potência / controlo / manobrabilidade · conforto e adequação física (dores) · prós e contras ·
porque serve este jogador · link «Ver na Street Padel ↗». Uma das 3 é «A melhor para ti».

- **Specs:** formato, peso, balanço, perfil, núcleo, faces e aro vêm da descrição da loja. Dureza, ponto doce e o
  resto, se a descrição não os disser, aparecem como «não indicado». A IA pode *explicar* (o porquê, os prós e os
  contras), mas não pode afirmar um número que não esteja na descrição que recebeu.
- **Rodapé obrigatório:** «Sugestões feitas por IA a partir do catálogo da Street Padel. Preços e stock de hoje.»
- **Instrução do Renato, para o prompt (tal e qual, traduzida):** dar prioridade à adequação ao jogador, ao conforto e
  ao desempenho, não à popularidade da marca nem só ao preço. Não recomendar automaticamente uma raquete avançada ou
  cara só porque tem melhores specs técnicas.

## Os ecrãs (ver mockups v2)

Seguem `DESIGN.md`: fundo cinzento `ground`, cartões brancos, Outfit nos títulos e preços, rótulos em Geist Mono,
**um só botão lima por ecrã**.

1. **Perfil (`src/pages/Profile.jsx`):** cartão branco «Escolhe a tua raquete» com uma foto pequena e «11 perguntas.
   3 raquetes para ti, com preço.» Depois de haver resultado: «As tuas raquetes», com as 3 fotos pequenas. Não é
   preto: o preto é das ações de organizador.
2. **Pergunta:** «‹», «5 de 11» em mono, barra de progresso, título Outfit, opções em blocos de 48px (escolhida = borda
   preta 2px e ✓), «Seguinte» lima preso em baixo. Voltar atrás mantém as respostas. Sair a meio não guarda nada.
3. **A pensar:** um estado de espera com o Alino enquanto a IA responde (alguns segundos).
4. **Resultado:** «Para ti» / «As tuas 3 raquetes». A melhor num cartão maior com contorno lima e o selo «A melhor
   para ti». As outras duas em cartões compactos (foto 64px, nome, preço, uma linha). Cada cartão abre a ficha
   completa. Em baixo, «Refazer as perguntas» em outline.
5. **Erros:** sem IA disponível (quota ou falha) → «Tenta daqui a pouco», as respostas ficam em memória para tentar
   de novo sem repetir o questionário. Nenhuma raquete cabe nos filtros (por exemplo < 80 € e nada em stock) → dizê-lo
   e sugerir subir o orçamento. Nunca mostrar uma lista vazia sem explicação.

Rotas sugeridas: `/perfil/raquete` (resultado ou início) e `/perfil/raquete/perguntas`.

## Como se faz (decisões do Claude, nesta conversa, aceites pelo Renato)

### Catálogo: Street Padel, cópia diária
- A Street Padel (Espanha, envia para Portugal em EUR) é uma loja Shopify com o catálogo público em
  `https://www.streetpadel.com/products.json?limit=250&page=N` (até a página vir vazia, ~5000 produtos).
  Verificado a 27 out: 739 produtos com `product_type = "Palas"`, cada um com `title`, `vendor`, `handle`,
  `body_html` (descrição com formato, balanço, peso, perfil, materiais), `images[].src` e `variants[]`
  (`price`, `available`).
- Uma **Edge Function `sync-raquetes`** corre uma vez por dia (pg_cron + chamada HTTP, como o
  `cancel-stale-mixes` e o webhook do push) e guarda as raquetes numa tabela nossa, `rackets`.
  O questionário nunca depende do site da loja estar de pé.
- **Filtrar fora:** packs e duos (`pack`, `tripack`, `duo` no título) e pickleball (`pickleball` no título). A 27 out
  ficam 263 raquetes individuais em stock.
- Guardar por raquete: id da loja, nome, marca, preço (o da variante mais barata disponível), disponível, link
  (`https://www.streetpadel.com/products/<handle>`), foto principal, descrição em texto simples e as specs que se
  conseguem tirar da descrição (formato, balanço, peso, perfil, núcleo, faces). As specs extraídas podem ficar em
  colunas ou em JSON. Raquetes que desaparecem do catálogo ficam marcadas como indisponíveis, não se apagam (um
  resultado antigo pode apontar para elas).
- A loja tem de ser trocável: o link e o nome da loja saem de um só sítio.

### Recomendar: Edge Function `recomendar-raquete`
1. Recebe as respostas e valida o JWT (como o `watch-session`).
2. Junta o lado, a mão e o nível do perfil.
3. **Filtra no código:** só raquetes disponíveis e com preço ≤ orçamento. A marca **não filtra**, só vai como
   preferência (senão «só Nox, < 80 €» dava zero). Se ainda forem muitas, reduz para uma lista curta (por exemplo por
   formato pedido e por perto do topo do orçamento) com um tamanho que caiba bem no prompt. O builder escolhe o tamanho.
4. Chama a IA com as respostas, o perfil e a lista curta (id, nome, marca, preço, specs, descrição curta). Pede uma
   resposta JSON estruturada: 3 ids, qual é a melhor e, para cada uma, o porquê, os prós e os contras.
5. **Valida:** cada id tem de estar na lista curta e os 3 têm de ser diferentes. Se não, volta a tentar uma vez; se
   falhar outra vez, devolve erro (não mostra lixo).
6. Guarda e devolve.

### A IA: Gemini Flash, plano gratuito
- O Renato pediu o melhor modelo gratuito. Escolha: o Gemini Flash mais recente disponível no plano gratuito da API
  do Google (AI Studio), com saída JSON estruturada. A chave fica como secret da Edge Function, nunca na app.
- **Incerto:** em 2026 o Google cortou o plano gratuito e deixou de publicar os limites por modelo (fontes externas
  dizem entre ~100 e ~1500 pedidos por dia). Ver o limite real na consola do AI Studio antes de lançar.
- **Limite nosso:** 3 recomendações por jogador por dia (contado no servidor), para não esgotar a quota.
- No plano gratuito o Google pode usar o que recebe para melhorar os modelos. Só vão as respostas do questionário e as
  raquetes: **nunca** nome, email, id do jogador ou dados de saúde além de «dor no cotovelo/pulso/ombro».
- Trocar de modelo tem de ser mexer só nesta função.

### Guardar o resultado
- Tabela `racket_picks`: uma linha por jogador (a última), com as respostas, os 3 ids da loja, qual é a melhor, os
  textos da IA e a data.
- **RLS:** cada jogador lê só a sua linha. Escreve só a Edge Function (service role); o browser não escreve nesta
  tabela. A tabela `rackets` é de leitura para utilizadores autenticados e de escrita só pelo sync.
- **Ao mostrar um resultado guardado,** o preço, a foto, o stock e o link vêm da `rackets` de hoje, não do que ficou
  guardado. Esgotada → selo «Esgotada» e sugestão de refazer. Desaparecida do catálogo → idem.
- Refazer substitui a linha.

### Migração
- Uma migração nova (`supabase/migration_escolher_raquete.sql`) com as duas tabelas, RLS, a contagem diária e o job do
  pg_cron. **Não está ativa só por estar no repo:** tem de ser corrida à mão no dev e depois em produção, antes de o
  código ir para `main`. As duas Edge Functions também têm de ser publicadas à mão, e o secret do Gemini configurado
  nos dois projetos.
- Apps nativas: o código antigo nas lojas não conhece estas tabelas, por isso não há nada a manter compatível. A
  funcionalidade aparece nas apps com a próxima build.

### Outras decisões do Claude (da releitura, para o Renato confirmar ao ler)
- **Língua dos textos da IA:** a da app no momento do questionário (pt, en ou es), pedida no prompt. Fica guardada
  assim; mudar de língua depois não os traduz.
- **Onde aparece:** para todos os jogadores com sessão, no site e nas apps (é o Perfil, igual em todo o lado).
- **Contagem diária** (3 por dia): o dia é o de Lisboa.
- **Apagar a conta apaga o resultado:** `racket_picks` com `ON DELETE CASCADE` a partir de `profiles`. As respostas
  sobre dores são dados de saúde leves: ficam só aqui, só o próprio as lê, e nunca vão para logs.
- **Fotos:** usa-se o URL da foto no CDN da Shopify tal como vem no catálogo, sem copiar para o nosso storage.
- **Mesma chave do Gemini no dev e em produção** chega para o piloto. A quota é por projeto do Google, por isso os
  testes no dev gastam a mesma quota.

## Fica para o builder

- Os textos exatos dos ecrãs e das opções, em pt/en/es.
- Como extrair as specs da descrição (regex simples chega para formato, balanço, peso e perfil). O que não se
  conseguir extrair fica «não indicado».
- O tamanho da lista curta e a ordenação.
- O prompt (dentro das regras acima) e o esquema JSON da resposta.
- Os componentes visuais, desde que sigam os mockups v2 e o `DESIGN.md`.
- A hora do sync diário.

## Adenda (Renato, 27 out, depois de testar no dev)

- **As 3 raquetes são de 3 marcas diferentes.** Garantido no código: a lista curta tem no máximo
  2 raquetes por marca, a IA devolve 5 por ordem e `validatePicks` fica com as 3 primeiras de marcas
  diferentes (recusa
  `same_brand` e a IA tenta outra vez), a não ser que a lista curta tenha menos de 3 marcas.
- **Em empate, marca conhecida.** A regra «não à popularidade da marca» continua, mas quando
  duas raquetes servem o jogador de forma parecida fica a de uma marca conhecida
  (`POPULAR_BRANDS` em `_shared/raquetes.js`: Nox, Bullpadel, Adidas, Head, Babolat). Isto é
  pedido à IA no prompt (cada raquete vai marcada `popular: true/false`); não é um filtro.
- Origem: ao testar com 200–300 €, a IA recomendava quase sempre Royal Padel.
