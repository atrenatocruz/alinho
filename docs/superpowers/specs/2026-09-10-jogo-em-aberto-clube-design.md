# Jogo em aberto (lançado pelo clube): ranked por defeito, correção por democracia — design

Data: 2026-09-10. Decisão de Francisco. Não confundir com "jogo individual entre amigos" (`2026-09-10-jogo-individual-ranked-opcional-design.md`) — são duas funcionalidades distintas, com regras de confiança diferentes.

## O que é

Um jogo lançado pelo admin de um clube para preencher horários/campos livres com vagas na app — funciona como um mix (evento organizado, com vagas a preencher), não como um jogo pessoal entre amigos.

## Regras

1. **Ranked por defeito** — ao contrário do jogo entre amigos, não há escolha de intenção do criador.
2. **Entrar = aceitar automaticamente ficar registado.** Não existe opção de recusar ou sair (não tem o "rejeitar/eliminar" do jogo entre amigos). Só é possível disputar o resultado depois de submetido.
3. **Correção do resultado por "democracia"**: qualquer participante pode sugerir uma correção, mas só vale se **todos** os participantes aceitarem.
4. **Exceção — resultado inserido pelo admin**: se foi o admin do clube a inserir o resultado, só o admin o pode alterar depois — os jogadores não se podem sobrepor a um resultado inserido por ele.
5. **Sem eliminar/sair** — essa opção é exclusiva do jogo entre amigos.

## Casos-limite / por decidir

- Fluxo de inscrição ainda não definido: pela app, igual ao mix? Também via WhatsApp? Como se entra em dupla? (perguntas levantadas em equipa a 10 set 2026, sem resposta ainda).
- Sobreposição com o motor de torneios (`2026-09-09-torneio-grupos-eliminatorias-design.md`, já implementado em `dev`) — a decidir se o jogo em aberto reaproveita alguma coisa desse motor ou é totalmente separado.

## Futuro (registar, não construir agora)

Quando existir booking real de campos (MVP 4), o sistema podia detetar horários/campos livres e lançar jogos em aberto automaticamente para os preencher, em vez do admin criar à mão.

## Ficheiros

Trello: https://trello.com/c/InkROE4X/236-jogo-em-aberto-lan%C3%A7ado-pelo-clube-ranked-por-defeito-corre%C3%A7%C3%A3o-por-democracia (Design — ainda não confirmado para construção, ao contrário do 233).
