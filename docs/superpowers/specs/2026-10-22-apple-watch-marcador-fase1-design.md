# Marcador no Apple Watch: Fase 1 (só contar pontos)

Data: 2026-10-22 · Escrito a partir do protótipo, a pedido do Renato (sem ronda de perguntas).
Protótipo: https://claude.ai/artifact/PmzAm5WTHVY48KY9BczyLD («Marcador do relógio»).
O protótipo cita `design-handoff/2026-10-22-relogio` (ecrãs e `REGRAS-BA.md`), que **não está
no repositório**. Este documento segue o código do protótipo; se o handoff disser outra
coisa, o handoff ganha e este documento atualiza-se.

## Porquê

Contar os pontos num jogo de padel sem tirar o telemóvel do bolso e sem discutir «quanto
estava?». A Fase 1 é só o marcador, sozinho no relógio. A ligação ao alinho (jogadores,
mixes, resultados para o ranking) fica para fases seguintes, por isso a Fase 1 tem de
nascer onde essa ligação vai viver: dentro da app iOS do alinho.

Sucesso na Fase 1: o Renato e o Francisco jogam um jogo inteiro com o relógio, via
TestFlight, sem perder a contagem, e saem com uma decisão sobre o tempo do toque (0,7 s).

## Decidido pelo Renato (nesta conversa)

- Fica neste repositório, não num repositório à parte.
- Testa-se pelo TestFlight no relógio dele, com builds na cloud (Codemagic), sem depender
  do Xcode no Mac (o Mac está no Sonoma; a App Store só aceita builds do Xcode 26).
- O desenho é o do protótipo.

## Escolhas técnicas (minhas)

- **SwiftUI nativo**, watchOS 10 ou mais recente. Nada do `src/` passa para o relógio.
- **Alvo watchOS dentro do projeto iOS existente** (`ios/App/App.xcodeproj`), como app
  companheira da `pt.alinho.app`: bundle id `pt.alinho.app.watchkitapp`, nome «alinho»,
  `WKCompanionAppBundleIdentifier = pt.alinho.app` e
  `WKRunsIndependentlyOfCompanionApp = true` (funciona mesmo sem abrir a app do iPhone).
  A app iOS embute-a («Embed Watch Content»). Assim fica na mesma ficha da App Store e
  não há migração quando ligarmos ao alinho.
- **Regras num pacote Swift à parte**, `ios/AlinhoWatch/PadelScoring` (Swift Package
  local, sem dependências, sem SwiftUI). O alvo do relógio usa-o; os testes correm com
  `swift test` num Mac da cloud, sem simulador. É aqui que se apanham os erros antes de
  gastar uma build do TestFlight.
- **Código da app** em `ios/AlinhoWatch/App/`. Sem pods, sem SPM remotos, sem rede.
- **Guardar** com `Codable` + JSON num ficheiro (ou `UserDefaults`), como o protótipo faz
  com o `localStorage`: configuração, jogo a decorrer, pilha de desfazer (até 400) e
  últimos 20 jogos. Fechar a app ou reiniciar o relógio não perde o jogo.
- **Letra**: SF Compact do sistema (pesos Black/Heavy, algarismos de largura fixa) em vez
  de embutir Outfit/Geist. Lê-se melhor no relógio e poupa ficheiros. Se o Francisco
  quiser a Outfit nos números, embute-se só essa.
- **Texto só em pt-PT** na Fase 1, mas num String Catalog, para o inglês entrar depois
  sem mexer no código. Sem travessões «—» nos textos (regra de 21 out, #715).
- **Trabalho num branch `feature/apple-watch`**, não no `dev`. Motivo: quando o alvo
  estiver embutido, a próxima versão iOS enviada para revisão leva o relógio para o
  público. Junta-se ao `dev` quando o Renato decidir que o relógio pode sair com a app.
  O Codemagic deixa escolher o branch na build manual.

## Regras (iguais ao protótipo)

Equipas: «Nós» (0) e «Eles» (1). Cada ponto aplica-se a uma cópia do estado; o estado
anterior vai para a pilha de desfazer.

**Formatos**

| Código | Nome | Jogos para o set | Tie-break aos | Sets para ganhar |
|---|---|---|---|---|
| `m3` | Melhor de 3 sets | 6, por 2 | 6-6 | 2 |
| `stb` | 2 sets + super tie-break | 6, por 2 | 6-6 | 2; a 1-1 joga-se super tie-break |
| `pro9` | Pro set a 9 | 9, por 2 | 8-8 | 1 |
| `s1` | 1 set | 6, por 2 | 6-6 | 1 |
| `pts` | Pontos | não há jogos | n/a | n/a |

**Jogo normal**: 0, 15, 30, 40. Ganha-se o jogo com um ponto a partir de 40 quando o
outro não está em 40. Aos 40-40 depende do modo escolhido:

- **Ponto de ouro** (`ouro`, por omissão): o ponto seguinte decide.
- **Vantagens** (`vant`): vantagem e iguais até alguém ganhar 2 pontos seguidos.
- **Star Point** (`star`): conta-se cada vez que se chega a iguais (`dc`: 1 ao primeiro
  40-40, +1 cada vez que uma vantagem se perde). Com `dc` igual a 1 ou 2 joga-se vantagem
  normal; ao terceiro iguais (`dc >= 3`) o ponto seguinte decide.

**Tie-break** (aos 6-6, ou 8-8 no pro set): a 7 por 2. Quem o ganha leva o set 7-6
(ou 9-8). **Super tie-break**: a 10 por 2, conta como o 3.º set (guarda-se 10-x).

**Pontos** (`pts`): soma simples. Total da ronda 16, 24, 32 ou sem total. Com total,
acaba quando a soma dos dois chega ao total; ganha quem tiver mais, ou empate.

**Serviço** (opcional: «Não mostrar», «Nós», «Eles»; não existe em `pts`): troca a cada
jogo. No tie-break e super tie-break, o 1.º ponto é servido por quem calhava e depois
troca a cada 2 pontos. No set seguinte serve primeiro quem recebeu o 1.º ponto do
tie-break. Mostra-se com uma bolinha no bloco de quem serve.

**Troca de lado**: depois de cada jogo em que o total de jogos do set fica ímpar; no
fim de um set, se o total de jogos desse set for ímpar. **Diferença em relação ao
protótipo (escolha minha):** no tie-break e super tie-break troca-se também a cada 6
pontos (regra oficial), que o protótipo não avisa. Se o handoff da BA disser o
contrário, tira-se.

**Ponto decisivo** (ouro ao 40-40, ou Star Point com `dc >= 3`): aviso «Ponto de ouro» /
«Star Point», «Quem recebe escolhe o lado».

**Terminar antes do fim**: o vencedor é quem tem mais sets; com sets empatados, quem
tem mais jogos no set a decorrer; senão empate. O jogo a meio (pontos) não conta, e o
ecrã diz isso: «O jogo a meio (30-15) não conta.»

**Resultado em texto**: sets separados por espaço (`6-4 3-6 10-8`); se terminou antes do
fim, junta os jogos do set a decorrer; `0-0` se não houver nada; `pts` mostra `12-12`.

Os casos de teste do pacote cobrem cada linha acima, incluindo desfazer depois de um
set, depois de entrar em tie-break e depois de terminar.

## Ecrãs (como no protótipo)

Fundo sempre preto. Lima `#C5DD01` para «Nós» e destaques, cinza `#D9DCE0` para «Eles»,
texto escuro `#040404` nos blocos, vermelho `#FF6B5E` para terminar, cinza `#9EA3AA`
para texto secundário, listas em `#1D1E21`.

1. **Novo jogo**: linhas «Formato», «Aos 40-40» (ou «Total da ronda» em Pontos),
   «Quem serve» (não aparece em Pontos), cada uma abre uma lista de escolha com o visto
   na atual e uma linha de explicação nos modos do 40-40 («Aos 40-40 joga-se um ponto
   só.», «Duas vantagens; se continuar, um ponto decide.», «Ganha quem fizer 2 pontos
   seguidos.»). Botão lima «Começar». A última escolha fica guardada.
2. **Marcador** (página 1): linha de cima com o estado (sets e jogos `6-4 · 2-1`, ou em
   destaque lima «Tie-break a 7», «Super tie-break a 10», «Ponto de ouro», «Iguais 2»,
   «Vantagem 1»…) e a hora. Dois blocos grandes lado a lado, «NÓS» e «ELES»,
   com o ponto em número grande («Vant.» mais pequeno). Por baixo, pílula «↺ Desfazer»
   (desativada sem nada para desfazer).
3. **Menu do jogo** (página 2, deslizar para a esquerda; pontos de página por baixo):
   formato curto, resultado atual, «Últimos jogos», pílula vermelha «Terminar o jogo»
   com «Mantém o dedo para terminar».
4. **Aviso** por cima do marcador durante 2 s: lima, «⇄ Trocar de lado» com o
   resultado, ou o aviso de ponto decisivo.
5. **Fim**: «Ganharam Nós» / «Ganharam Eles» / «Empatado», resultado grande, formato e
   duração (ou a nota de terminado antes do fim), botão «Novo jogo».
6. **Últimos jogos**: até 20, mais recente primeiro, com resultado, vencedor, data
   («22 out»), formato curto e «Terminado» se acabou antes. Vazio: «Ainda não há jogos.
   Acaba um e aparece aqui.»

**Toque comprido**: dar ponto, desfazer e terminar exigem o dedo pousado 0,7 s; o bloco
enche de baixo para cima (a pílula da esquerda para a direita). Largar antes não conta.
O 0,7 s fica numa constante só, para afinar depois do jogo de teste. Depois do ponto, o
bloco pisca com um contorno branco.

**Vibração** (`WKInterfaceDevice.play`): ponto e desfazer curta (`.click`); set ganho e
fim de jogo longa (`.success`); troca de lado e ponto decisivo dupla (`.notification`).
O mapeamento exato afina-se no pulso.

**Pulso em baixo** (Always On, `isLuminanceReduced`): blocos escurecidos (`#3E4500` e
`#2A2B2D`, texto `#C9CCD1`), linha de cima a 60%, «Desfazer» escondido.

**Tamanhos**: o protótipo testa 41 e 45 mm; o layout é relativo ao ecrã e tem de caber
de 40 a 49 mm (Ultra) sem cortar números.

## Builds e testes

- `codemagic.yaml`, workflow `ios-testflight`:
  - novo passo antes de compilar: `swift test` em `ios/AlinhoWatch/PadelScoring`
    (falha a build se as regras falharem);
  - assinatura para os dois bundle ids (`pt.alinho.app` e `pt.alinho.app.watchkitapp`);
  - o `agvtool new-version -all` já atualiza o número da build dos dois alvos; a versão
    de marketing do relógio é a mesma da app iOS.
- Uma vez, à mão (Renato): registar o App ID `pt.alinho.app.watchkitapp` no portal da
  Apple e fazer «Fetch profiles» no Codemagic (o mesmo problema de
  `docs/native-apps.md`, «No matching profiles»).
- Criar o alvo uma vez no Xcode do Mac (File → New → Target → watchOS App) é o caminho
  seguro; editar o `project.pbxproj` à mão é possível mas cada erro custa uma build.
- Instalar: TestFlight no iPhone → alinho → a app do relógio instala sozinha ou pela
  app Watch.
- `docs/native-apps.md` ganha uma secção «Apple Watch» com estes passos.

**Jogo de teste no campo** (lista para o Renato e o Francisco): um jogo completo em cada
modo do 40-40; um tie-break; desfazer a meio de um tie-break; baixar o pulso vários
minutos e voltar; tempo do toque (0,5 / 0,7 / 0,9 s) com suor e luvas; toques acidentais.

## Risco a vigiar no jogo de teste

Com o pulso em baixo muito tempo, o watchOS volta ao mostrador e o marcador sai do
ecrã (o jogo não se perde, mas é preciso reabrir a app). Na Fase 1 não se usa sessão de
treino (HealthKit) para evitar pedir permissões de saúde. Se no campo isto incomodar,
a solução é uma Fase 1.1 com `HKWorkoutSession` (atividade de raquetes), que também
mantém a app à frente; até lá, o jogador pode pôr «Voltar à app» nas definições do
relógio.

## Fora de âmbito (fases seguintes)

Ligação ao alinho (login, escolher o mix, jogadores, enviar resultado para o ranking),
WatchConnectivity com o iPhone, complicações no mostrador, HealthKit/treino, ecrã no
iPhone, inglês, Coroa Digital para pontuar, estatísticas, corrigir o resultado à mão.
O formato do jogo guardado deve ter em conta que um dia vai ser enviado ao alinho
(guardar hora de início e fim, formato, sets e modo do 40-40), mas sem ids do alinho.

## Fica para quem constrói

Estrutura das vistas SwiftUI, nomes dos tipos, formato exato do JSON guardado, como se
mostra o enchimento do toque, e o mapeamento final das vibrações.
