# Jogo em aberto (lançado pelo clube): ranked por defeito, correção por democracia — design

Data: 2026-09-10. Decisão de Francisco. Não confundir com "jogo individual entre amigos" (`2026-09-10-jogo-individual-ranked-opcional-design.md`) — são duas funcionalidades distintas, com regras de confiança diferentes.

## O que é

Um jogo lançado pelo admin de um clube para preencher horários/campos livres com vagas na app — funciona como um mix (evento organizado, com vagas a preencher), não como um jogo pessoal entre amigos.

Cria-se dentro do "modo clube" (área ainda por construir) — não é uma funcionalidade pessoal como o jogo entre amigos. O modo clube vai ter 3 tipos de evento para já — jogo em aberto, mixes, torneios — com liga a chegar no futuro (Francisco, 11 set 2026). Ligação direta ao tema "homepage unificada" que ficou para a segunda fase na conversa de 10 set 2026 (ver histórico) — este é provavelmente o sítio onde esses 3-4 tipos de evento se cruzam.

## Regras

1. **Ranked por defeito, mas o admin do clube pode desligar** (Francisco, 11 set 2026, corrigindo a versão anterior desta nota que dizia "sempre ranked, sem escolha") — semelhante ao toggle ranked/amigável já construído no jogo entre amigos (#233), só que aqui a escolha é do admin do clube ao criar o jogo em aberto, não de cada jogador a responder depois.
2. **Entrar = aceitar automaticamente ficar registado — mas pode cancelar a participação a qualquer momento até o resultado ser inserido.** Correção (Francisco, 11 set 2026) à versão anterior desta nota, que dizia "sem volta atrás": não é isso — imprevistos acontecem (alguém pode ter de cancelar por qualquer motivo), por isso sair antes do jogo acontecer/ser decidido continua sempre possível, em qualquer situação. O que NÃO é possível é sair **depois de o resultado já estar inserido** — nesse ponto a pessoa já ficou associada ao jogo para sempre, tal como o jogo entre amigos bloqueia a edição depois de confirmado. Aplica-se **só** a jogos criados pelo clube (o jogo entre amigos tem as suas próprias regras de saída, #233, e não muda nada por causa disto). O ecrã deve mostrar sempre, antes de aceitar, se o jogo está ranked ou não.
3. **Correção do resultado por "democracia"**: qualquer participante pode sugerir uma correção, mas só vale se **todos** os participantes aceitarem.
4. **Exceção — resultado inserido pelo admin**: se foi o admin do clube a inserir o resultado, só o admin o pode alterar depois — os jogadores não se podem sobrepor a um resultado inserido por ele.
5. **Cancelar participação**: possível a qualquer momento enquanto o jogo ainda não tem resultado inserido (ver ponto 2) — não confundir com "eliminar o jogo inteiro", que continua a ser exclusivo de quem o criou/admin.

## Casos-limite / por decidir

- Fluxo de inscrição ainda não definido: pela app, igual ao mix? Também via WhatsApp? Como se entra em dupla? (perguntas levantadas em equipa a 10 set 2026, sem resposta ainda).
- Sobreposição com o motor de torneios (`2026-09-09-torneio-grupos-eliminatorias-design.md`, já implementado em `dev`) — a decidir se o jogo em aberto reaproveita alguma coisa desse motor ou é totalmente separado.

## Futuro (registar, não construir agora)

Quando existir booking real de campos (MVP 4), o sistema podia detetar horários/campos livres e lançar jogos em aberto automaticamente para os preencher, em vez do admin criar à mão.

## Ficheiros

Trello: https://trello.com/c/InkROE4X/236-jogo-em-aberto-lan%C3%A7ado-pelo-clube-ranked-por-defeito-corre%C3%A7%C3%A3o-por-democracia (Design — ainda não confirmado para construção, ao contrário do 233).
