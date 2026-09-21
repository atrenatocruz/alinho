# SMTP próprio + base de email transacional — design

Data: 2026-09-21. Pedido (Ruben): "tratar do SMTP para todas as necessidades desta app".

## Ponto de partida

- O único email que a app envia hoje é o de recuperação de password (`resetPasswordForEmail`, `src/contexts/AuthContext.jsx`), pelo **mailer partilhado do Supabase** — limitado a poucos emails por hora, remetente `supabase.io`, e explicitamente não destinado a produção.
- "Confirm email" está desligado (`DEPLOYMENT.md`), e ligá-lo é uma ação pendente do `SECURITY_REVIEW.md` — inviável sem SMTP próprio, porque cada registo passaria a gastar um email da quota partilhada.
- Não existe nenhum provider, nenhuma função que envie email, nem `supabase/config.toml` — toda a configuração de Auth vive no dashboard.
- `alinho.pt` tem DNS no Cloudflare, sem SPF, DKIM ou DMARC.
- Tudo o que é notificação de produto (convites de clube, jogos privados, lembretes, promoção de suplente) chega só pelo sino in-app ou pelo bot de WhatsApp.

## Decisões

| Questão | Decisão |
| --- | --- |
| Provider | **Resend.** Plano gratuito (3.000/mês, 100/dia) chega para o piloto; tem SMTP (para o Supabase Auth) e API HTTP (para a Edge Function); região EU. |
| Domínio de envio | **`alinho.pt`** verificado no Resend. Os registos que o Resend pede ficam em `send.alinho.pt` (MX + SPF do return-path) e `resend._domainkey.alinho.pt` (DKIM) — não tocam no MX/TXT da raiz. Acrescenta-se `_dmarc.alinho.pt` com `p=none` para começar. |
| Remetente | `alinho <noreply@alinho.pt>`, `Reply-To: alinhopt@gmail.com` (o contacto que a política de privacidade já indica). |
| Âmbito | **Fase 1** — SMTP no Supabase Auth, template PT de confirmação de registo, ligar "Confirm email". **Fase 2** — Edge Function `send-email` reutilizável + primeiro caso de uso: convite de clube. |
| Quem compõe o email | **Sempre o servidor.** A função recebe `{ type, ...ids }`, nunca destinatário, assunto ou corpo. Ver "Segurança". |
| Idioma | Emails de Auth: só PT (o Supabase tem um texto por email). Emails transacionais: `profiles.language` do destinatário (`pt`/`en`). |
| Restantes notificações (jogos privados, lembretes, suplentes) | **Fora desta ronda.** São recorrentes, por isso exigem primeiro preferências de notificação/opt-out por utilizador — spec própria. |

## Fase 1 — Supabase Auth por SMTP próprio

Tudo configuração de dashboard; o repo só versiona os templates e o checklist.

1. Resend: criar conta, adicionar domínio `alinho.pt` (região EU), copiar os registos DNS para o Cloudflare (**DNS only**, sem proxy), esperar pela verificação.
2. Resend: criar API key com permissão "Sending access" restrita a `alinho.pt`.
3. Supabase → Authentication → Emails → SMTP Settings: host `smtp.resend.com`, porta `465`, user `resend`, password = API key, sender `noreply@alinho.pt`, nome `alinho`.
4. Supabase → Authentication → Rate Limits: subir "emails per hour" (o default com SMTP próprio é 30/h) para um valor coerente com o limite de 100/dia do Resend.
5. Colar os templates PT: `reset-password.pt.html` (já existe) e o novo `confirm-signup.pt.html`.
6. Testar recuperação de password de ponta a ponta. **Só depois** ligar "Confirm email".

### Ligar "Confirm email" — o que muda na app

- `signUp` deixa de devolver sessão; `Login.jsx` tem de mostrar "verifica o teu email" em vez de assumir login feito. `src/lib/errors.js` já mapeia `email_not_confirmed`. Validar este ecrã antes de ligar o toggle.
- Contas existentes não são afetadas (já estão confirmadas). Contas sintéticas (`@padelapp.test`, `guest-…@whatsapp.alinho.pt`) são criadas com `email_confirm: true`, por isso também não.
- Google OAuth não passa por confirmação.

## Fase 2 — Edge Function `send-email`

`supabase/functions/send-email/index.ts`, mesmo esqueleto das funções existentes (CORS, `decodeJwt`, rejeita `role: anon`, cliente service-role).

```
POST { type: 'organization_invite', organization_id: '<uuid>', user_id: '<uuid>' }
```

- Um registo `handlers[type]` — cada tipo valida a autorização do chamador, resolve o destinatário e devolve `{ to, subject, html }`. Acrescentar um tipo novo = acrescentar um handler; layout HTML (o mesmo visual do template de reset) e chamada ao Resend são partilhados.
- Envio por `fetch('https://api.resend.com/emails')` com `RESEND_API_KEY`. Secrets da função: `RESEND_API_KEY`, `EMAIL_FROM` (default `alinho <noreply@alinho.pt>`), `EMAIL_REPLY_TO`, `APP_URL` (default `https://alinho.pt`).
- Nunca envia para endereços sintéticos (`%@padelapp.test`, `%@whatsapp.alinho.pt`) — responde `{ sent: false }`, a mesma resposta indiferenciada de "convite não é teu" e "já foi enviado"; o motivo só fica nos logs da função, para não servir de sonda.

### Segurança

A pergunta do CLAUDE.md — "o que impede alguém de chamar isto diretamente?":

- A função **não aceita destinatário nem conteúdo**. Um atacante autenticado só consegue pedir "envia o email do convite X", e o handler só o faz se o chamador for quem criou esse convite (`invited_by`), o convite estiver `pending`, e ainda não tiver sido enviado. Não é um relay aberto.
- Anti-repetição atómica em Postgres: RPC `claim_organization_invite_email(p_organization_id, p_invited_user_id, p_caller_id)` (o par clube+convidado é UNIQUE e é o que o cliente tem à mão — `invite_to_organization` não devolve o id), `SECURITY DEFINER`, **só `service_role`** tem EXECUTE. Faz `UPDATE … SET emailed_at = now() WHERE … AND (emailed_at IS NULL OR emailed_at < created_at) RETURNING …`. Duas chamadas concorrentes → só uma envia. Reabrir um convite recusado repõe `created_at` (comportamento que `invite_to_organization` já tem), o que volta a permitir um envio.
- Se o Resend falhar depois do claim, a função repõe `emailed_at = NULL` (best-effort). O convite in-app existe sempre — o email é um extra, nunca o único canal.

### Dados

`supabase/migration_organization_invite_email.sql`:

- `ALTER TABLE organization_invites ADD COLUMN emailed_at TIMESTAMPTZ;`
- `claim_organization_invite_email` (acima), devolve `invited_user_id`, nome do clube, nome de quem convidou, `as_admin`, idioma do convidado.

### Cliente

`src/lib/orgInvites.js`: depois de `invite_to_organization` devolver `pending`, chama `supabase.functions.invoke('send-email', …)` sem bloquear nem falhar o convite — erro de email fica só no `console.error`. A mensagem ao admin ("Convite enviado a X") não muda.

## Fora de âmbito

- Emails de jogos privados, lembretes, promoção de suplente, avisos de aulas — precisam de preferências/opt-out primeiro.
- Formulário de contacto na landing; caixa de entrada `@alinho.pt` (receção de email).
- Webhooks de bounce/complaint do Resend.
- Templates de Auth para fluxos que a app não usa (magic link, invite, email change).
