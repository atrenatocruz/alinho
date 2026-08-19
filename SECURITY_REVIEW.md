# Auditoria de Segurança — alinho (então "padel.app")

**Data:** 2026-07-16
**Âmbito:** revisão completa do projeto (schema SQL/RLS, triggers, funções, autenticação, páginas com escritas na BD, histórico git, dependências).
**Contexto:** o modelo de segurança desta app assenta 100% nas policies RLS do Supabase — a chave `anon` está no bundle JS e qualquer pessoa pode falar diretamente com a API REST do Supabase, ignorando a UI. Todos os pontos abaixo devem ser avaliados por essa lente.

**Estado:** ⬜ por corrigir · ✅ corrigido · 🔧 corrigido no código, falta ação manual tua

**Validação (2026-07-16):** todos os pontos abaixo foram confirmados diretamente no código antes de corrigir (não foi assumida nenhuma afirmação do relatório original sem verificar). Fixes de SQL estão consolidados em `supabase/migration_security_fixes.sql` — **tens de correr esse ficheiro no SQL Editor do Supabase** para os pontos #1, #2 (mínimo), #3, #7 e #8 terem efeito; nada disto se aplica sozinho.

---

## 🔴 Críticas (corrigir antes de ter utilizadores reais)

### 1. ✅ Qualquer utilizador pode tornar-se admin sozinho

**Confirmado:** a policy `"Users can update own profile"` (`supabase/schema.sql:89-91`) tem `USING (auth.uid() = id)` sem `WITH CHECK` — em RLS do Postgres, sem `WITH CHECK`, o `USING` serve para ambos, logo não há nenhuma restrição de colunas. Qualquer utilizador autenticado podia de facto correr:

```js
await supabase.from('profiles').update({ is_admin: true }).eq('id', meuId)
```

**Corrigido em `supabase/migration_security_fixes.sql`:**
- Trigger `prevent_self_admin_escalation` (`BEFORE UPDATE` em `profiles`) bloqueia qualquer mudança a `is_admin`/`is_guest` feita por quem não é já admin.
- Nova RPC `admin_set_admin(p_user_id, p_is_admin)`, `SECURITY DEFINER` com guard de admin (mesmo estilo do `admin_delete_user` já existente), com proteção extra contra um admin remover a própria permissão sozinho.
- `src/pages/Admin.jsx` `handleToggleAdmin` atualizado para chamar esta RPC em vez do UPDATE direto que **confirmei estar mesmo partido** para outros utilizadores (0 linhas afetadas, sem erro, exatamente como o relatório apontava).

🔧 **Falta fazer:** correr `supabase/migration_security_fixes.sql` no SQL Editor do Supabase.

### 2. 🔧 Dados pessoais de todos os membros expostos publicamente à internet

**Confirmado:** `"Public profiles are viewable by everyone"` com `USING (true)` (`schema.sql:85-87`) — qualquer pessoa sem login, com a anon key, lia nome, email, telefone, data de nascimento e género de todos os membros.

**Corrigido (nível mínimo) em `supabase/migration_security_fixes.sql`:** a policy passa a `USING (auth.uid() IS NOT NULL)` — só membros autenticados veem perfis. Verifiquei todos os pontos do frontend que leem `profiles` (`AuthContext.jsx`, `Admin.jsx`, `Rankings.jsx`, `PlayerDetails.jsx`, `GameDetails.jsx`) — todos correm depois de login, nenhum depende de leitura anónima, por isso este fix não parte nada.

🔧 **Falta fazer:**
1. Correr `supabase/migration_security_fixes.sql`.
2. **Nível ideal, não aplicado automaticamente:** manter `email/phone/birthday` visíveis só ao próprio e criar uma view `profiles_public` (id, name, level, gender, preferred_side, is_guest) para o resto da app. Não fiz isto sozinho porque implica rever e ajustar todos os `select()` de `profiles` no frontend um por um — risco de partir algo silenciosamente sem testar cada página. Recomendo pedires isto como tarefa dedicada quando quiseres avançar (é o "trabalho de uma tarde" que o relatório original já estimava).

---

## 🟠 Altas

### 3. 🔧 Bug de scoping na policy de resultados

**Confirmado exatamente como descrito:** em `schema.sql:161` (dentro da policy `"Participants and admins can submit results"`), `WHERE participants.game_id = game_id` — o `game_id` não qualificado, dentro da subquery sobre `participants`, resolve para `participants.game_id` (a tabela mais interna no escopo), não para o `game_id` da linha a inserir em `results`. Condição sempre verdadeira: qualquer utilizador que participe em *qualquer* jogo podia submeter resultados para *todos* os jogos.

**Corrigido em `supabase/migration_security_fixes.sql`:** policy recriada com `participants.game_id = results.game_id`.

🔧 **Falta fazer:** correr `supabase/migration_security_fixes.sql`.

### 4. ⬜ Desligar "Allow anonymous sign-ins" no dashboard Supabase

Não corrigido por mim — é um toggle no dashboard, não código. Da última vez que vi o painel de Authentication, este toggle estava desligado, mas **confirma tu mesmo** (não tenho acesso automatizado ao dashboard para verificar o estado atual):

**Ação:** Dashboard → Authentication → Sign In / Providers → confirmar que "Allow anonymous sign-ins" está desligado.

---

## 🟡 Médias

### 5. ✅ Dependências vulneráveis

**Confirmado:** `npm audit` reportava exatamente 21 vulnerabilidades (13 high), validando o número do relatório.

**Corrigido:** corri `npm audit fix` (sem `--force`) — desceu para **3 vulnerabilidades (2 moderate, 1 high)**, todas em `esbuild`/`vite`/`vite-plugin-pwa`, que só têm fix via bump major (vite 5→8). Não fiz esse bump — implica testar o build/dev-server a fundo e não é urgente (é tooling de dev, não corre em produção), exatamente como o relatório original categorizava. Build de produção verificado (`npm run build`) e continua a funcionar sem erros depois do fix aplicado.

### 6. ✅ Headers de segurança ausentes

**Confirmado:** `vercel.json` só tinha `rewrites`.

**Corrigido:** adicionados `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security` (HSTS) em `vercel.json`.

**Não fiz o CSP** (mencionado como bónus/opcional no relatório original) — um CSP mal afinado pode partir a app silenciosamente (Google Fonts, o WebSocket do Supabase Realtime, o service worker do PWA) e só se deteta a testar no browser a sério, não só a compilar. Recomendo só ativar depois de testar num preview deploy.

### 7. ✅ Funções `SECURITY DEFINER` sem `SET search_path`

**Confirmado:** `finalize_mix`, `admin_delete_user`, `handle_new_user`, `check_game_reopen` não tinham `SET search_path`.

**Corrigido em `supabase/migration_security_fixes.sql`:** `ALTER FUNCTION ... SET search_path = public` nas quatro. Revi o corpo de cada uma para confirmar que não dependem de nenhum schema fora de `public`/`pg_catalog` (este último está sempre implicitamente no search_path do Postgres) — não deviam quebrar nada.

🔧 **Falta fazer:** correr `supabase/migration_security_fixes.sql`.

### 8. ✅ Triggers a esbarrar no RLS (bugs funcionais com raiz em segurança)

**Confirmado, e mais grave na prática do que "correr o fluxo antigo de resultados":** verifiquei que a tabela `results`/`update_player_stats` **não é usada em lado nenhum do frontend atual** (só existe o fluxo novo via `matches`/`finalize_mix`) — por isso essa parte específica é hoje código morto, ainda vale a pena endurecer mas não é um bug ativo.

`check_game_full`, porém, **é um bug ativo agora**: não sendo `SECURITY DEFINER`, corre com as permissões de quem se está a inscrever. Quando um jogador normal (não-admin) completa as vagas de um mix, o `UPDATE games SET status='closed'` é bloqueado silenciosamente pela policy `"Admins can update games"` — **mixes preenchidos por jogadores normais nunca fechavam automaticamente**, só fechavam se por acaso quem desse a última vaga fosse admin.

**Corrigido em `supabase/migration_security_fixes.sql`:** `check_game_full` passa a `SECURITY DEFINER` (mesmo padrão já usado em `check_game_reopen`) + `SET search_path = public`.

🔧 **Falta fazer:** correr `supabase/migration_security_fixes.sql`.

---

## 🟢 Baixas / opcionais

### 9. ⬜ `participants` sem `WITH CHECK` fino

Não corrigido — o próprio relatório recomendava deixar isto para depois ("só corrigir se aparecer abuso"), mantenho essa recomendação.

### 10. ⬜ Configuração do dashboard Supabase

Não corrigido — configuração do dashboard, não código.

**Ação:** confirmar email ligado, password mínima ≥ 8 caracteres, e rever os rate limits default de auth em Authentication → Policies/Rate Limits.

---

## ✅ O que está bem (não mexer)

- **Anon key no bundle e placeholders no `INSTALLATION.md`** — é o modelo normal do Supabase; **não há segredos reais no git** (histórico completo verificado).
- **Bypass "Entrar como Admin (dev)"** — corretamente gated por `import.meta.env.DEV` (não entra no build de produção) e é só ilusão client-side: sem JWT real, o RLS bloqueia tudo.
- **`admin_delete_user` e `finalize_mix`** — bem desenhados (guard de admin, `REVOKE` de anon, transacional).
- **XSS** — React escapa output por defeito e não há `dangerouslySetInnerHTML`; risco baixo.

---

## Prioridade sugerida

| Ordem | Pontos | Esforço | Impacto |
|-------|--------|---------|---------|
| 1 | #1, #3, #4 | ~30 min | Fecha as portas graves (escalada de privilégios, escrita indevida) |
| 2 | #2 | meio dia (nível ideal) | Protege dados pessoais / RGPD |
| 3 | #5, #6, #7, #8 | 1–2 h | Higiene incremental |
| 4 | #9, #10 | opcional | Endurecimento extra |

Tudo dentro do free tier, sem custos novos.

---

## O que preciso que faças agora

1. **Corre `supabase/migration_security_fixes.sql`** no SQL Editor do Supabase — sem isto, #1, #3, #7 e #8 continuam vulneráveis/partidos, o ficheiro só descreve o fix, não aplica sozinho.
2. **Confirma o toggle "Allow anonymous sign-ins"** está desligado (#4) — Dashboard → Authentication → Sign In / Providers.
3. **Rever configuração de auth do dashboard** (#10) — email confirmation, password mínima, rate limits.
4. Deploy normal do `vercel.json`/`package.json` atualizados (próximo `git push` já trata disto).

Não fiz sozinho (ficam para quando quiseres avançar, não são urgentes):
- **#2 nível ideal** — view `profiles_public` + ajustar todos os selects do frontend (risco de partir coisas sem testar página a página).
- **CSP** em #6 — precisa de testar num preview deploy antes de ativar.
- **#5 resto** — bump major de vite/vite-plugin-pwa.
- **#9** — deixado como estava, por recomendação do próprio relatório original.
