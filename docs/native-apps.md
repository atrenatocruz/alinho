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

## Fase 2 (iPhone) — ainda por fazer

Sign in with Apple, notificações push (Android também), ecrã sem rede, menu de
partilha do iOS, `npx cap add ios`, builds na cloud (Codemagic) porque o Mac
com Sonoma não corre o Xcode 26. Plano: https://claude.ai/artifact/MNdTgShgM8H2FEkQ3zjzJX
