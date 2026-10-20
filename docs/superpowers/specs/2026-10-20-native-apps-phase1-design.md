# Apps das lojas — Fase 1 (Capacitor + Android)

Data: 2026-10-20 · Decidido com o Renato, em conversa.
Plano de lançamento (Francisco, Renato, Ruben, 19 out): https://claude.ai/artifact/MNdTgShgM8H2FEkQ3zjzJX

## Porquê

Levar o alinho à Play Store e à App Store **sem deixar de ser o site** alinho.pt.
A Google obriga a 14 dias de teste fechado em contas novas — é o caminho crítico,
por isso o Android vem primeiro.

## Decidido pelo Renato

- Web, Android e iPhone a partir do mesmo código. O site não muda.
- A app leva os ecrãs dentro (não carrega o alinho.pt ao vivo): as correções
  chegam à app na versão seguinte da loja.

## Escolhas técnicas (minhas, aceites pelo Renato)

- Capacitor 8 (memória «future_native_app»: ~100% do código reaproveitado; React
  Native obrigava a reescrever tudo).
- `appId` = `pt.alinho.app` (não se muda depois de publicada).
- Login com o Google no browser do sistema (a Google bloqueia login em WebViews),
  volta por esquema próprio `pt.alinho.app://auth-callback`, fluxo implícito do
  supabase-js (tokens no fragmento → `setSession`).
- Emails de confirmação/recuperação continuam a apontar ao alinho.pt (podem ser
  abertos noutro aparelho).
- Links partilhados sempre com `https://www.alinho.pt` na app.
- Sem service worker nem «instalar app» dentro da app; `/` sem sessão → `/login`.
- `viewport-fit=cover` só no build nativo; Capacitor SystemBars (`css`) trata das
  margens no Android 15+.
- Ícone a partir de `src/logo/icon-mark-square.svg`; splash no verde do #boot.

## Fora de âmbito (Fase 2+)

Sign in with Apple, push, ecrã offline, partilha iOS, projeto iOS, App Links
verificados (precisa da impressão digital da Play Console), «atualiza a app»
para versões antigas, botão «voltar» do Android a fechar folhas abertas.

## Consequência a lembrar

Versões antigas da app ficam em uso: mudanças na BD têm de ser compatíveis com a
versão anterior durante algumas semanas.
