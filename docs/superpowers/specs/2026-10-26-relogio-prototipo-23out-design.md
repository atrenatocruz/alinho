# Relógio do alinho: o protótipo de 23 out (por cima da Fase 1)

Data: 2026-10-26.
**Fonte que manda:** o protótipo https://claude.ai/artifact/PmzAm5WTHVY48KY9BczyLD, na versão
que o Francisco aprovou a 23 out (o `<script>` é a referência das regras e dos textos), mais
as decisões do Renato abaixo. Onde esta spec disser outra coisa, ganha esta spec.
Vem por cima de `2026-10-22-apple-watch-marcador-fase1-design.md`, que já está feita no branch
`feature/apple-watch` (regras, desfazer, Novo jogo, marcador, menu, fim, últimos jogos,
sessão de treino, CI). O que essa spec dizia e esta não muda continua a valer.

## Decidido pelo Renato (nesta conversa)

- **Pontos passa a ser «jogos sem sets».** Cada jogo conta-se 0, 15, 30, 40 com a regra do
  40-40 escolhida; cada jogo ganho soma 1 ao marcador da ronda; não há sets nem tie-breaks.
  A linha de cima mostra «Jogos 5-3 · até 24» (ou «Jogos 5-3» sem total); os blocos mostram
  15/30/40 em grande. Acaba quando a soma dos jogos chega ao total (16, 24 por omissão, 32
  ou sem total); ganha quem tiver mais jogos, ou empate. Resultado «13-11» (jogos).
- **Âmbito: tudo o que está no protótipo, em três fases**, cada uma entregável sozinha:
  - **A. Só relógio.** Tudo o que corre no pulso, incluindo o Saúde e o esforço.
  - **B. Relógio → iPhone.** Os jogos do relógio chegam à app e aparecem em «Os meus
    números» (Jogos, Estatísticas, Desafios sem amigos).
  - **C. Registar e amigos.** «Registar o jogo» com os outros três, aceites, ranking;
    desafio de 7 dias e «Amigos esta semana».

## O que muda no relógio (Fase A), tirado do protótipo

**Novo jogo**: linhas Formato; «Aos 40-40» (também nos Pontos); nos Pontos ainda «Total da
ronda»; «Quem serve» (Não mostrar / Nós / Eles, também nos Pontos); se Nós servem, «Na nossa
dupla, serve primeiro» (Eu / O meu parceiro); «Marcador» (Lado a lado / Um por cima do outro,
«Muda só a arrumação. As regras e as cores ficam iguais.»); «Começar»; «Últimos jogos».

**Quem serve, por jogador.** Na nossa dupla alterna eu / parceiro de cada vez que voltamos a
servir. O bloco mostra «Tu · direita» / «Parceiro · esquerda» (lado: direita com a soma dos
pontos do jogo par, esquerda com ímpar, também no tie-break) e o bloco deles «Servem».

**Linha de estado**: «Em pausa» (âmbar) > estado do 40-40 > «Ponto de jogo» (o próximo ponto
de alguém acaba o jogo todo) > «Ponto de set» > «Tie-break a 7» / «Super tie-break a 10» >
sets e jogos («6-4 · 3-2»). Por baixo do «Desfazer», à direita, os minutos de jogo sem as
pausas («23 min»). O «↺ Desfazer» passa para uma pílula no topo (dedo pousado).

**Segundo ecrã** (deslizar para a direita): resultado e minutos; Pausar / Continuar; Acertar
o marcador; Mudar quem serve (Nós · eu / Nós · o meu parceiro / Eles, «Vale do próximo ponto
em diante.»); Aos 40-40 («Vale a partir do próximo jogo.»); Últimos jogos; Terminar o jogo
(dedo pousado e depois o ecrã «Terminar o jogo?», «Contam os sets e os jogos fechados. O jogo
a meio não conta.», Terminar / Cancelar). Pausar, mudar quem serve, acertar e terminar
desfazem-se com o «Desfazer».

**Acertar o marcador**: «Jogos» e «Pontos» de Nós e Eles; toca-se num número e roda-se a
coroa; jogos 0 a 12; pontos 0 a 40 em tie-break/super, senão 0, 15, 30, 40, Vant. (só um lado
pode ter vantagem, e só com o outro a 40). Ao guardar, quem serve recalcula-se pelo número de
jogos jogados; Star Point a 40-40 sem contagem passa a «Iguais 1».

**Treino** (deslizar para a esquerda): tempo mm:ss, pulsação, kcal, pulsação média, zona 1 a
5. Sem acesso ao Saúde: «Sem acesso ao Saúde. O jogo conta na mesma; o treino não fica
guardado.» O treino grava-se no Saúde (padel), com pausa quando o jogo está em pausa.
Fora do marcador, 10 s sem mexer volta ao marcador.

**Proteções**: pulso em baixo, o primeiro toque só acorda; os dois blocos ao mesmo tempo
não contam; arrastar mais de 24 pt cancela; vibração de um toque para Nós e dois para Eles.

**Jogo esquecido**: 20 min sem pontos (e sem pausa) → «Ainda estão a jogar?», «Não há
pontos há 20 minutos.», Continuar / Terminar o jogo.

**Fim**: «Esforço» primeiro, se houve pelo menos um ponto: «Quão duro foi?», «Roda a coroa»,
1 a 10 (começa em 6): 1-3 Fácil, 4-6 Moderado, 7-8 Difícil, 9-10 No limite; Guardar / Saltar.
Depois o ecrã de fim: «Ganhámos» / «Ganharam eles» / «Empatado»; resultado; formato e duração
(ou «Terminado antes do fim» e «O jogo a meio (30-15) não conta.»); «♥ 142 bpm · 610 kcal ·
esforço 7»; Novo jogo; Últimos jogos; ↺ Desfazer; «Para sair, carrega na coroa.»
Um jogo sem pontos não fica nos Últimos jogos.

**Mudar o 40-40 a meio** só vale a partir do jogo seguinte.

## Escolhas minhas (a confirmar no jogo de teste)

- Pontos por jogos: troca de lado nos jogos ímpares (como num set); quem serve muda a cada
  jogo; o ponto decisivo avisa como nos sets. Os totais 16/24/32 passam a contar jogos; se o
  Francisco achar 24 jogos demasiado, muda-se só a lista `pointsTotalOptions`.
- Um jogo de Pontos antigo (pontos corridos) que esteja a decorrer quando a app atualiza é
  terminado e guardado como estava; os registos antigos continuam a mostrar «15-9».
- Zonas de pulsação: limites fixos do protótipo (110 / 125 / 140 / 155 bpm) numa constante.
  O watchOS não dá as zonas do utilizador por API.
- O esforço grava-se no registo do jogo; em watchOS 11 ou mais recente também vai para o
  Saúde (`workoutEffortScore`).

## Fases B e C

**B.** O relógio manda cada jogo acabado ao iPhone (`WCSession.transferUserInfo`, que chega
mesmo com a app fechada). Um plugin Capacitor da app iOS guarda os jogos num ficheiro e dá-os
à app web. **A saúde (pulsação, kcal, esforço) fica só no iPhone, nunca vai ao Supabase.**
«Os meus números» é uma página web nova, só em iOS nativo, com três separadores:
- **Jogos**: por mês (nome, n.º de jogos, % de vitórias, minutos); cada jogo com quem ganhou,
  resultado, dia, formato, minutos, ♥ bpm, kcal, esforço. «Não registar e apagar» apaga do
  telemóvel. («Registar o jogo» só aparece na Fase C.)
- **Estatísticas**: frase do mês («5 jogos em outubro, mais 2 do que em setembro» / «Ainda
  não jogaste em outubro»); barras dos últimos 6 meses (vitórias por cima); tendências
  (jogos por mês e % de vitórias, últimos 90 dias contra o ano); semana: minutos contra os
  150 da OMS e esforço («Acima do costume» / «Igual ao costume» / «Abaixo do costume»).
- **Desafios**: objetivo de jogos por mês (8 por omissão, 1 a 30), anel, medalhas dos meses
  cumpridos, sequência, pausar o objetivo (até 90 dias sem perder a sequência). Aviso
  local à segunda de manhã: «A tua semana no padel».
- **Nada inventado**: os meses de exemplo do protótipo não vão para a app. Sem jogos,
  estados vazios que o dizem.

**C.** «Registar o jogo» (até 7 dias depois): parceiro e dois adversários (amigos ou
convidado), onde fica (perfil ou grupo), resultado vindo do relógio e editável; cria um jogo
entre amigos com as RPCs que já existem e os outros três aceitam (só conta para o ranking com
os quatro). Se o resultado foi mudado à mão, os outros veem os dois. Desafio de 7 dias com um
amigo e «Amigos esta semana» contam só jogos registados; **aos amigos só aparecem os jogos,
nunca a saúde.** Isto precisa de migrações e RLS novas (ver o plano).

## Fora de âmbito

Mostrar o jogo a quem está de fora, complicações, espanhol, Android Wear, o formato vir de
um jogo criado na app.
