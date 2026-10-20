# Notificações push nas apps das lojas — desenho

20 out 2026 · pedido do Renato («avança com o tema das notificações») depois da
primeira build no TestFlight. Fase 2 do plano das apps
(https://claude.ai/artifact/MNdTgShgM8H2FEkQ3zjzJX).

## Porquê

- Quem joga quer saber logo que entrou, saiu, mudou de dupla ou que o mix foi
  cancelado — hoje só vê no sino ao abrir a app (ou no WhatsApp, se o grupo tem
  o robô).
- A regra 4.2 da App Store recusa apps que são «só o site numa moldura». As
  notificações push são o argumento mais forte de que a app faz mais do que o site.

## O que é (e o que não é)

- **Os avisos do sino, também como push.** Nenhum aviso novo: cada linha que
  nasce na tabela `notifications` (já criada por dezenas de funções da BD e
  pelo robô) é enviada aos telemóveis da pessoa. Uma fonte só — o sino e o push
  dizem sempre o mesmo.
- **Só nas apps das lojas.** No site (incluindo a PWA) não há push (seria Web
  Push, outro projeto).
- **Não** há definições por tipo de aviso dentro da app; quem não quer desliga
  nas definições do telemóvel. (Se houver pedidos, vem depois.)
- **Não** se manda push do que a própria pessoa fez (actor_id = destinatário).

## Como funciona

```
app (src/lib/push.js) ──register_push_device──▶ push_devices (RLS, sem acesso direto)
                                                    ▲
notifications INSERT ──Database Webhook──▶ send-push (Edge Function, service role)
                                              ├─ Android → FCM HTTP v1 (conta de serviço)
                                              └─ iPhone  → APNs (chave .p8)
```

- **Telemóvel:** `@capacitor/push-notifications`. Com sessão, pede autorização
  uma vez (o sistema só pergunta enquanto não houver resposta) e regista o token.
  Ao sair da conta, o token é apagado (`unregister_push_device`) *antes* do
  signOut (precisa da sessão). Tocar na notificação abre `data.path`.
- **Android** precisa do Firebase (`google-services.json`); sem ele a app
  fechava ao pedir o token, por isso o Gradle recusa compilar sem o ficheiro.
- **iPhone** usa o APNs diretamente (sem o SDK do Firebase no iOS: menos peso,
  e o Codemagic não precisa de mais um ficheiro). `aps-environment` no
  `App.entitlements`; o App ID tem de ter *Push Notifications* e o perfil de
  distribuição tem de ser gerado outra vez depois de o ligar.
- **BD:** `migration_push_dispositivos.sql` — tabela `push_devices` (token PK,
  user_id, platform), RLS ligado sem políticas, e duas funções SECURITY DEFINER
  para a própria pessoa. Um token que já era de outra conta passa para a que
  entrou agora (o mesmo telemóvel, outra conta). Só acrescenta: as versões
  antigas da app não mudam.
- **Servidor:** `supabase/functions/send-push` — chamada por um Database Webhook
  (INSERT em `notifications`) com o cabeçalho `x-push-secret`; deploy com
  `--no-verify-jwt`. Escreve o texto na língua do perfil: os avisos de mix com
  os mesmos textos do sino; os outros (aulas, torneios, amigos, liga) com um
  texto geral «Tens um aviso novo. Toca para ver.» e a página certa. Tokens que
  a Google/Apple dizem que já não existem são apagados.

## Decisões minhas (a rever se fizer diferença)

- Pedir autorização logo ao entrar, sem ecrã a explicar antes. Simples; um ecrã
  «queres avisos?» pode vir depois se a taxa de aceitação for baixa.
- Texto geral para os tipos que não são de mix, em vez de copiar já todos os
  textos do sino para o servidor (são muitos e mudam com frequência).
- Título sempre «alinho».
- Webhook do painel do Supabase em vez de um trigger com `pg_net` na migração:
  não põe segredos na BD e liga/desliga-se sem SQL.

## Fora deste passo

Contador no ícone (badge), ícone próprio da notificação no Android (usa o da
app), textos próprios para aulas/torneios/amigos/liga, Web Push no site.
