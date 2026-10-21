# Apps das lojas (Android e iPhone)

O alinho continua a ser o site `alinho.pt`. As apps das lojas são o mesmo código
(`src/`) dentro de uma moldura nativa — [Capacitor](https://capacitorjs.com) 8.
Não há fork: o que muda só na app está atrás de `IS_NATIVE` (`src/lib/native.js`).

Decisão de 20 out 2026 (Renato): **a app leva os ecrãs lá dentro** — uma correção
no alinho.pt chega ao site logo, e à app só na versão seguinte da loja.
Consequência: **há sempre pessoas com a versão anterior da app.** Uma mudança na
BD (coluna, RPC, política) tem de continuar a funcionar com a versão anterior
durante umas semanas — acrescentar, não renomear nem apagar de repente.

## O que é diferente na app

| | Site | App |
|---|---|---|
| Endereço da página | `https://www.alinho.pt` | `https://localhost` (Android), `capacitor://localhost` (iPhone) |
| Links partilhados / QR / emails | `window.location.origin` | sempre `https://www.alinho.pt` (`appOrigin()`, `appHref()`) |
| Login com o Google | redireciona a página | abre no browser do telemóvel e volta por `pt.alinho.app://auth-callback` (`nativeShell.js`) |
| `/` sem sessão | landing | vai para `/login` |
| Service worker, «Adicionar ao ecrã principal» | sim | não (os ficheiros vêm dentro da app) |
| Barra das horas | do browser | a página vai por baixo (`viewport-fit=cover`); `env(safe-area-inset-*)` dá as medidas |

Ao escrever um link para outra pessoa abrir, usa `appOrigin()`/`appHref()`, nunca
`window.location.origin`.

## Builds

```
npm run build:native        # BD de desenvolvimento (.env) — para testar
npm run cap:sync            # build:native + copia para android/ (e ios/)
npm run cap:sync:prod       # BD de produção (.env.native-prod.local)
npm run android:bundle      # cap:sync:prod + .aab assinado para a Play Store
npm run android:open        # abre o projeto no Android Studio (se instalado)
```

O `.aab` sai em `android/app/build/outputs/bundle/release/app-release.aab`.
Antes de cada envio para a loja, sobe o `versionCode` (e o `versionName`) em
`android/app/build.gradle` — a Play Store recusa um número repetido.

### Ferramentas (Windows, sem Android Studio)

- **JDK 21** (o Capacitor 8 não compila com o 17): `%LOCALAPPDATA%\Programs\jdk-21.*`
- **Android SDK**: `%LOCALAPPDATA%\Android\Sdk` (platform-tools, platforms;android-36, build-tools)
- `android/local.properties` (fora do git): `sdk.dir=C:/Users/<nome>/AppData/Local/Android/Sdk`

Na PowerShell, antes do Gradle:

```
$env:JAVA_HOME = "$env:LOCALAPPDATA\Programs\jdk-21.0.12.1+1"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

Os `.bat` do SDK falham com espaços no caminho («C:\Users\Renato Cruz») quando
chamados do Git Bash — usa a PowerShell, ou o caminho curto `C:\Users\RENATO~1`.

### Ficheiros fora do git (guardar cópia!)

- `.env.native-prod.local` — URL e chave pública do Supabase de produção, e a
  chave do Turnstile (os mesmos valores que estão no bundle do alinho.pt).
- `android/keystore.properties` + `C:\Users\Renato Cruz\.alinho-keys\alinho-upload.jks`
  — a **chave de upload** da Play Store e a palavra-passe. Guardar os dois num
  gestor de palavras-passe. Com o Play App Signing (o normal), perder a chave de
  upload não perde a app, mas obriga a pedir um reset à Google (dias).

## Configuração fora do código (dashboards)

1. **Supabase → Authentication → URL Configuration → Redirect URLs**, nos dois
   projetos (dev e prod): acrescentar `pt.alinho.app://auth-callback**`.
   Sem isto, o login com o Google na app volta ao site em vez de à app.
2. **Cloudflare → Turnstile → widget do alinho → Hostnames**: acrescentar
   `localhost`. A app abre em `localhost`; sem isto, o captcha falha e o login
   com email/password na app de produção não passa.
3. **Google Places** (escolher o local do clube, em Gerir): a chave está presa ao
   domínio `alinho.pt`. Na app o pedido vem de `localhost` — acrescentar
   `localhost` às referências da chave, ou aceitar que o seletor não funciona na app.
4. **App Links** (links do alinho.pt abrem diretamente na app): depois de a app
   estar na Play Console, copiar a impressão digital SHA-256 da *app signing key*
   (Play Console → Teste e lançamento → Integridade da app) para
   `public/.well-known/assetlinks.json`:

   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": { "namespace": "android_app", "package_name": "pt.alinho.app",
                 "sha256_cert_fingerprints": ["AA:BB:…"] }
   }]
   ```

   Até lá, os links abrem no browser, como hoje.

## Android: teste fechado (contas pessoais novas)

A Google obriga a um teste fechado com **12+ pessoas inscritas 14 dias seguidos**
antes de pedir a produção. Pode-se enviar versões novas durante o teste sem
recomeçar a contagem. Cada pessoa precisa de Android e de uma conta Gmail.

## iPhone

O projeto está em `ios/` (Swift Package Manager, sem CocoaPods). Só iPhone, só
na vertical (`TARGETED_DEVICE_FAMILY = 1`): num iPad abre em modo de compatibilidade.

**Sign in with Apple** (obrigatório, regra 4.8 da App Store, porque há login com
o Google): botão só na app de iPhone (`Login.jsx`, `showApple`). A janela é a
nativa da Apple (`@capacitor-community/apple-sign-in`); o token vai para o
Supabase com `signInWithIdToken` (`AuthContext.signInWithApple`). A Apple só
manda o nome no primeiro login: grava-se por cima do «Novo Utilizador».

### Builds no Codemagic

O Mac do Renato (Sonoma 14.8.2) não corre o Xcode 26, que a App Store exige. O
`codemagic.yaml` compila na cloud e envia para o TestFlight. Corre à mão no
painel, ou com uma tag `ios-v*` (`git tag ios-v1.0.0 && git push origin ios-v1.0.0`).

Configuração única (feita nos painéis, não no código):

1. **Apple Developer → Identifiers**: App ID `pt.alinho.app` com *Sign In with Apple*.
2. **App Store Connect → Apps → +**: app iOS, bundle `pt.alinho.app`, idioma
   Português (Portugal). O número «Apple ID» da app vai para `APP_STORE_APPLE_ID`.
3. **App Store Connect → Utilizadores e acesso → Integrações → App Store Connect API**:
   chave de equipa com acesso *App Manager*. O `.p8` só se descarrega uma vez.
4. **Supabase (prod e dev) → Authentication → Providers → Apple**: ativar, e em
   *Client IDs* pôr `pt.alinho.app`. Para o login nativo não é precisa a *Secret Key*.
5. **Codemagic** (entrar com o GitHub, adicionar o repositório):
   - *Team settings → Integrations → Developer Portal*: a chave do passo 3, com o
     nome **`alinho_asc`** (Issuer ID, Key ID, `.p8`).
   - *Code signing identities → iOS certificates → Generate certificate* (Apple Distribution).
   - O Codemagic **não cria o perfil** («No matching profiles found for bundle
     identifier»): em Apple Developer → Profiles → + → *App Store Connect*, App ID
     `pt.alinho.app`, o certificado acima, nome `alinho appstore`. Depois, no
     Codemagic, *Code signing identities → iOS provisioning profiles → Fetch
     profiles* → `alinho appstore` → *Download selected* (referência `alinho_appstore`).
     O perfil caduca ao fim de um ano, ou se o certificado for revogado: repetir.
   - *Environment variables*: grupo **`alinho_prod`** com `VITE_SUPABASE_URL`,
     `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY` (os do
     `.env.native-prod.local`) e `APP_STORE_APPLE_ID`, todos *Secret*.
   - Na app do Codemagic, separador *codemagic.yaml*: escolher o branch onde o
     ficheiro está e *Check for configuration files*. Sem webhook (separador
     *Webhooks*), as tags `ios-v*` não lançam builds — lança-se à mão.

Primeira build no TestFlight: 20 out 2026 (build nº 2 do Codemagic, commit `188aff64`, ~4 min).

O plano gratuito do Codemagic dá 500 minutos/mês em Mac M2; uma build demora ~10–15 min.

## Notificações push

Os avisos do sino também chegam como notificação (só nas apps). Desenho:
`docs/superpowers/specs/2026-10-20-push-notifications-design.md`.
Código: `src/lib/push.js` (telemóvel), `supabase/functions/send-push` (envio),
`supabase/migration_push_dispositivos.sql` (tabela dos telemóveis).

Configuração única:

1. **Firebase** (console.firebase.google.com, conta do alinho): criar o projeto
   `alinho` → *Adicionar app* → Android, pacote `pt.alinho.app` → descarregar o
   `google-services.json` para `android/app/` (vai para o git; não é secreto).
   **Sem ele o Android não compila** (o Gradle recusa de propósito).
   Depois: *Definições do projeto → Contas de serviço → Gerar nova chave privada*
   → um JSON (esse **é secreto**: só para o segredo `FCM_SERVICE_ACCOUNT`).
2. **Apple Developer**:
   - *Identifiers* → `pt.alinho.app` → ligar **Push Notifications** → Save.
   - *Profiles* → `alinho appstore` → Edit → Save/Generate (o perfil antigo
     deixa de servir depois de ligar o push) → no Codemagic, *Fetch profiles*
     outra vez e substituir o `alinho_appstore`.
   - *Keys* → **+** → nome `alinho push`, marcar **Apple Push Notifications
     service (APNs)** → descarregar o `.p8` (só uma vez) e apontar o Key ID.
     O Team ID está no canto de cima à direita da conta.
3. **Supabase** (dev e prod):
   - Correr `migration_push_dispositivos.sql` no SQL Editor.
   - Edge Functions → criar `send-push` (colar `supabase/functions/send-push/index.ts`,
     ou `npx supabase functions deploy send-push --no-verify-jwt --project-ref <ref>`)
     com **Verify JWT desligado**.
   - Edge Functions → Secrets: `PUSH_WEBHOOK_SECRET` (uma palavra-passe longa
     inventada), `FCM_SERVICE_ACCOUNT` (o JSON todo), `APNS_KEY_ID`,
     `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (o texto do `.p8`).
   - Database → Webhooks → *Create*: tabela `notifications`, evento **Insert**,
     tipo *Supabase Edge Functions* → `send-push`, e um cabeçalho
     `x-push-secret` com o mesmo valor do `PUSH_WEBHOOK_SECRET`.

Em produção (`alinho-prd`) a função ficou com o nome **`smart-responder`** (o nome
automático do editor) — é o mesmo código do `send-push`. O webhook chama-se
`push_notifications`. Primeira notificação recebida num iPhone: 21 out 2026.

Testar: com a app instalada e a sessão aberta, alguém inscreve-te num mix (ou
sai a tua dupla) → chega «Quem organiza inscreveu-te no …». Os registos da
função (Edge Functions → send-push → Logs) dizem `sent`, `removed` e `errors`.

## Ainda por fazer

Ecrã sem rede, menu de partilha do iOS,
Universal Links (links do alinho.pt abrem na app de iPhone), um clube de
demonstração para o revisor da Apple e para as capturas finais.
Plano: https://claude.ai/artifact/MNdTgShgM8H2FEkQ3zjzJX
