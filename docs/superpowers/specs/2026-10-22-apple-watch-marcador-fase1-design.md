# Marcador no Apple Watch: Fase 1 (só contar pontos)

Data: 2026-10-22.
**Fonte que manda:** a entrega do Francisco, `docs/design-handoff/2026-10-22-relogio/Relogio-alinho-fase1.pdf`
(fechada com a UX, o PO, o PM e o BA; inclui os ecrãs da `proposta.png`).
Protótipo: https://claude.ai/artifact/PmzAm5WTHVY48KY9BczyLD. A lógica de pontuação está
no `<script>` (`point`, `pointLabels`, `topLine`, `decisive`) e serve de referência para os
testes, mas onde o PDF disser outra coisa, ganha o PDF.
Ainda não estão no repositório os ficheiros-fonte que o PDF cita (`CONCEITO-PM.md`,
`REGRAS-BA.md`, `MODOS-40-40-BA.md`, `SPEC-UX.md`, `proposta.png`).

## Porquê

Contar os pontos de um jogo de padel no pulso, sem tirar o telemóvel do bolso nem
discutir «quanto estava?». A Fase 1 é só o marcador, sozinho no relógio: abre e joga.
Na Fase 2 o resultado vai para a app como jogo entre amigos, por isso a Fase 1 nasce
dentro da app iOS do alinho e guarda o que a Fase 2 vai precisar.

**Pronto quando** (PDF): o Francisco marca um jogo real de 90 minutos sem nenhum ponto à
sorte; o «Desfazer» corrige um ponto errado em menos de 3 s; o resultado bate com o que se
jogou em todos os formatos; a bateria aguenta o jogo com folga (medir quanto gasta em
90 min); prints dos ecrãs vão à UX e ao Francisco antes do TestFlight.

## Decidido

Pelo Francisco (PDF):
- Faz: escolher o formato e começar; contar com o dedo pousado; «Desfazer»; passar
  sozinho de jogo, set, tie-break e super tie-break; avisar a troca de lado; resultado no
  fim; guardar os últimos jogos.
- Não faz: conta do alinho e envio para a app (Fase 2); mostrar a quem está de fora
  (Fase 3); pulsação, calorias e estatísticas (Fase 4). Sem nomes de jogadores, reservas,
  clubes, anúncios, pagamentos ou «Premium». Grátis.
- Línguas: **português e inglês** (inglês do Copywriter). Espanhol vem depois, com o resto
  da app.
- **O ecrã não se apaga a meio do jogo.** O como fica para quem constrói (ver abaixo).

Pelo Renato (nesta conversa):
- Quem desenvolve somos nós (Renato com o Claude), não o Ruben como diz o PDF. As
  decisões que o PDF deixa «ao Ruben» passam para nós e estão abaixo.
- O código fica neste repositório, dentro do projeto iOS da app.
- Testa-se pelo TestFlight num relógio verdadeiro, com builds no Codemagic.

## Escolhas técnicas (minhas)

- **SwiftUI nativo**, watchOS 10 ou mais recente.
- **Alvo watchOS no projeto iOS existente** (`ios/App/App.xcodeproj`), como app companheira
  da `pt.alinho.app`: bundle id `pt.alinho.app.watchkitapp`, nome «alinho»,
  `WKCompanionAppBundleIdentifier = pt.alinho.app`, `WKRunsIndependentlyOfCompanionApp = true`.
  A app iOS embute-a. Fica na mesma ficha da App Store; na Fase 2 não há migração.
- **Regras num Swift Package local**, `ios/AlinhoWatch/PadelScoring`, sem dependências nem
  SwiftUI, com testes que correm com `swift test` (sem simulador). Código da app em
  `ios/AlinhoWatch/App/`. Sem rede, sem pacotes de fora.
- **Ecrã sempre ligado: sessão de treino** (`HKWorkoutSession`, atividade padel/raquetes)
  enquanto há um jogo a decorrer; termina no fim do jogo ou em «Terminar». É a forma
  habitual que o PDF refere e deixa a pulsação pronta para a Fase 4. Custa pedir
  autorização ao HealthKit na primeira vez e aparece como treino na app Atividade.
  Na Fase 1 não se gravam dados de saúde: a sessão serve só para manter a app à frente.
  Se o treino na app Atividade for um problema, a alternativa é `WKExtendedRuntimeSession`,
  mas não há um tipo pensado para desporto e pode não aguentar 90 min.
- **Guardar** em JSON (`Codable`): configuração, jogo a decorrer, pilha de desfazer (até ao
  primeiro ponto do jogo) e últimos 20 jogos. Fechar a app ou desligar o relógio não
  perde o jogo. Cada jogo guarda já o que a Fase 2 vai pedir: formato, modo do 40-40,
  resultado, como acabou, dia, hora de início e duração.
- **Letra**: números em Outfit 900 (embutir só esse peso, como o PDF pede); o resto na
  letra do sistema, que o PDF permite («a UX vê nas prints»).
- **Textos num String Catalog** (pt-PT e en). Enquanto o inglês do Copywriter não chegar,
  ponho uma tradução provisória marcada para revisão. Sem «—» em nenhum texto.
- **Trabalho num branch `feature/apple-watch`**, não no `dev`: com o alvo embutido, a
  próxima versão iOS enviada para revisão levava o relógio para o público. Junta-se ao
  `dev` quando o Renato decidir.

## Regras de pontuação (BA)

«Nós» é sempre a dupla de quem tem o relógio. Cada ponto aplica-se a uma cópia do estado;
o estado anterior vai para a pilha de desfazer.

**Formatos** (escolhe-se ao abrir; fica guardado o último). Nomes iguais aos da app.

| Código | Nome | Set | Tie-break | Ganha |
|---|---|---|---|---|
| `m3` | Melhor de 3 sets | 6, com 2 de diferença | a 7, aos 6-6 | 2 sets |
| `stb` | 2 sets + super tie-break | 6, com 2 de diferença | a 7, aos 6-6 | 2 sets; a 1-1, super tie-break a 10 |
| `pro9` | Pro set a 9 | 9, com 2 de diferença | a 7, sempre, aos 8-8 | 1 set |
| `s1` | 1 set | 6, com 2 de diferença | a 7, aos 6-6 | 1 set |
| `pts` | Pontos (Americano) | sem jogos | n/a | ver abaixo |

**Pontos**: cada ponto soma 1. Total da ronda 16, **24 (por omissão)**, 32 ou sem total.
Acaba quando a soma dos dois chega ao total (ex.: 15-9); ganha quem tiver mais, ou
empate. Sem total, só acaba em «Terminar».

Fora da Fase 1: mix por tempo, «Mini set», sets a 4.

**Jogo**: 0, 15, 30, 40, jogo. Aos 40-40, três modos (ponto de ouro por omissão), que só
valem nos jogos, nunca nos tie-breaks:

- **Ponto de ouro**: um ponto decide.
- **Star Point**: «Iguais 1» → quem ganha fica com «Vantagem 1» (ganha outra vez: jogo;
  perde: «Iguais 2») → «Vantagem 2» (ganha: jogo; perde: «Iguais 3») → «Star Point»: um
  ponto decide.
- **Vantagens**: «Iguais» → «Vantagem» → jogo, ou volta a «Iguais». Sem limite.

**Ponto decisivo** (ponto de ouro ou Star Point): serve quem estava a servir; a dupla que
recebe escolhe o lado. Ecrã todo lima 2 s, vibração dupla, depois volta ao marcador.

**Tie-break**: pontos 1, 2, 3…; a 7 com 2 de diferença; conta como um jogo (7-6, ou 9-8
no pro set). **Super tie-break**: a 10 com 2 de diferença; conta como um set
(«6-4 3-6 10-7»).

**Trocar de lado**:
- no fim dos jogos ímpares do set (1.º, 3.º, 5.º…);
- no fim de um set, se o número de jogos desse set for ímpar (6-3 sim, 6-4 não);
- nos tie-breaks e no super tie-break, a cada 6 pontos somados (6, 12, 18…). O protótipo
  não faz este último caso; o PDF manda fazer.

**Quem serve** (só se se escolher quem serve primeiro; senão não se mostra; não existe
em Pontos): só a dupla, não o jogador. Muda a cada jogo. No tie-break, o 1.º ponto serve
a dupla a quem calhava o jogo, depois muda a cada 2 pontos (1, 2, 2, 2…). No set seguinte
começa a dupla que não serviu o último jogo do set; depois de um tie-break, serve primeiro
quem recebeu o 1.º ponto do tie-break.

**Desfazer**: volta ao estado exato de antes do último ponto, também quando esse ponto
fechou um jogo, um set ou o jogo todo. Pode repetir-se até ao primeiro ponto. Mesmo toque
comprido, sem pergunta.

**Fim pelas regras**: «Ganharam Nós · 6-4 3-6 10-7»; nos Pontos «15-9».
**Terminar antes do fim**: contam os sets e os jogos já fechados («6-4 4-6 3-3»); os pontos
do jogo a meio não contam. Se ficar empatado, «Empatado», sem vencedor; senão ganha quem
tem mais sets e, com sets iguais, mais jogos no set a decorrer.

Os testes do pacote cobrem cada regra acima, com desfazer depois de fechar um jogo, um
set, ao entrar e sair de tie-break, e depois do fim.

## Ecrãs (UX, ver as páginas 5 a 7 do PDF)

**Base**: fundo preto. «Nós» em bloco lima `#C5DD01`, «Eles» em cinzento-claro `#D9DCE0`,
texto a preto (`#040404`). Lima também nos destaques. Vermelho `#FF6B5E` em «Terminar o
jogo». Listas em `#1D1E21`, texto secundário `#9EA3AA`. Em 41 e 45 mm o desenho é o mesmo
e os blocos crescem; tem de caber de 40 a 49 mm, também com os textos em espanhol mais
compridos («Nosotros», «Punto de oro»), por isso a bola de quem serve fica em baixo e
não ao lado do nome.

1. **Novo jogo**: título «Novo jogo» e a hora; três linhas com a última escolha: formato;
   modo do 40-40 (nos Pontos, «Total: 24 pontos»); quem serve («Não mostrar» por
   omissão). «Começar» a lima. Tocar numa linha abre uma lista com visto (desce-se com
   a coroa). Por baixo da lista, uma linha de ajuda da opção marcada:
   - 40-40: «Aos 40-40 joga-se um ponto só.», «Duas vantagens; se continuar, um ponto
     decide.», «Ganha quem fizer 2 pontos seguidos.»
   - Quem serve: «Se escolheres, o relógio mostra quem serve em cada jogo.»
2. **Marcador**: linha de cima com os sets fechados e os jogos do set («6-4 · 3-2») e a
   hora; passa a lima e diz o estado quando é preciso: «Ponto de ouro», «Iguais»,
   «Vantagem», «Iguais 1», «Vantagem 1»… «Star Point», «Tie-break a 7», «Super tie-break
   a 10»; nos Pontos «Pontos · até 24». Blocos só com «NÓS» / «ELES» e os pontos em
   grande; quem tem vantagem mostra «Vant.». Bola preta em baixo, ao centro, no bloco de
   quem serve. Em baixo, «↺ Desfazer» em contorno branco a toda a largura.
3. **Dedo pousado** (0,7 s, numa constante só, para afinar no jogo de teste): o bloco
   escurece de baixo para cima; vibração leve ao pousar. Ao fim de 0,7 s: vibração forte,
   o número salta para o seguinte e o bloco pisca um contorno branco. Dedo sai antes: o
   bloco esvazia e não conta. Toque curto, manga, pulseira ou suor não contam.
4. **Ponto decisivo**: ecrã todo lima, «Ponto de ouro» ou «Star Point» e «Quem recebe
   escolhe o lado», 2 s.
5. **Trocar de lado**: ecrã todo lima, «⇄ Trocar de lado», o resultado e, se se mostra
   quem serve, quem serve a seguir («3-2 · Nós servimos»), 2 s, vibração dupla. Volta
   sozinho.
6. **Segundo ecrã** (deslizar para o lado, fora do marcador para não se tocar sem
   querer): formato curto, o resultado («Desliza para voltar ao marcador»), «Últimos
   jogos» e «Terminar o jogo» a vermelho, com «Mantém o dedo para terminar». Terminar é
   dedo pousado **e depois uma confirmação**.
7. **Fim**: «Ganharam Nós» / «Ganharam Eles» a lima (ou «Empatado» a branco), resultado
   em grande, formato e duração («Melhor de 3 sets · 1 h 22 min»), «Novo jogo» a lima
   (volta ao Novo jogo com a mesma escolha). Terminado antes: «Terminado antes do fim.
   O jogo a meio (30-15) não conta.»
8. **Últimos jogos**: resultado, quem ganhou, dia («22 out»), formato curto, «Terminado»
   quando acabou antes.
9. **Pulso em baixo** (Always On): blocos escurecidos (`#3E4500` e `#2A2B2D`, texto
   `#C9CCD1`), fica só o resultado, sem «Desfazer»; ao levantar o pulso volta ao normal.

**Vibrações**: leve ao pousar o dedo; forte quando o ponto conta; dupla para trocar de
lado e no ponto decisivo; longa no fim de um set e no fim do jogo. Os tipos exatos de
`WKHapticType` afinam-se no pulso.

**Textos (pt)**: Novo jogo · Começar · Formato · Aos 40-40 · Ponto de ouro · Star Point ·
Vantagens · Quem serve · Não mostrar · Nós · Eles · Desfazer · Iguais · Vantagem · Vant. ·
Tie-break a 7 · Super tie-break a 10 · Trocar de lado · Quem recebe escolhe o lado ·
Ganharam Nós · Ganharam Eles · Empatado · Terminado antes do fim · Últimos jogos ·
Terminar o jogo · Mantém o dedo para terminar.

## Builds e testes

- Enviar para o TestFlight pede o Xcode 26, que o Mac do Renato (Sonoma) não corre. As
  builds fazem-se no Codemagic, que já envia a app iOS. O Mac serve para criar o alvo
  uma vez no Xcode que tem e, se der, para ver os ecrãs no simulador. No workflow
  `ios-testflight`:
  - passo `swift test` em `ios/AlinhoWatch/PadelScoring` antes de compilar;
  - assinatura para `pt.alinho.app` e `pt.alinho.app.watchkitapp`;
  - o `agvtool new-version -all` já numera os dois alvos; a versão do relógio é a da
    app iOS.
- Uma vez, à mão (Renato): App ID `pt.alinho.app.watchkitapp` com HealthKit ligado,
  «Fetch profiles» no Codemagic (o mesmo problema de `docs/native-apps.md`), e criar o
  alvo watchOS no Xcode do Mac (File → New → Target → watchOS App). Editar o
  `project.pbxproj` à mão também dá, mas cada erro custa uma build.
- Instalar: TestFlight no iPhone → alinho → a app do relógio instala sozinha ou pela app
  Watch.
- `docs/native-apps.md` ganha uma secção «Apple Watch» com estes passos.

**Jogo de teste no campo**: um jogo de 90 min; cada modo do 40-40; um tie-break e um super
tie-break; desfazer a meio de um tie-break e depois do fim de um set; pulso em baixo
vários minutos; o ecrã não pode voltar ao mostrador; bateria antes e depois; tempo do
toque (0,5 / 0,7 / 0,9 s) com suor; toques acidentais.

## Por esclarecer com o Francisco

- **Desfazer depois do fim do jogo.** O PDF diz que o desfazer funciona «também quando
  esse ponto fechou o jogo todo», mas o ecrã de Fim só tem «Novo jogo». Proposta minha:
  pílula «↺ Desfazer» por baixo de «Novo jogo» no ecrã de Fim, que só existe enquanto não
  se começa outro jogo.
- **Confirmação do «Terminar o jogo».** O PDF pede dedo pousado e depois confirmação, sem
  ecrã desenhado. Proposta minha: o alerta do sistema com «Terminar» (vermelho) e
  «Cancelar».

## Fora de âmbito

Tudo o que o PDF põe na Fase 2 e seguintes: conta do alinho, envio do resultado, «Jogaste
agora…» na app, formato vindo de um jogo criado na app, WatchConnectivity, mostrar a
quem está de fora, pulsação e calorias, estatísticas. Também: complicações no mostrador,
ecrã no iPhone, espanhol. A escolha «Aos 40-40» na app web (secção 6 do PDF) está por
decidir pelo Francisco e é outro trabalho.

## Fica para quem constrói

Estrutura das vistas SwiftUI, nomes dos tipos, formato exato do JSON, a animação do
número a saltar e os tipos exatos de vibração.
