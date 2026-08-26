# Convites de clube (pesquisa + link) — design

Data: 2026-08-26. Pedido: em GerirClube.jsx → Membros, um admin poder convidar alguém que já está na app (pesquisa por nome) ou partilhar um link de convite que, ao fazer login/signup, junta a pessoa diretamente ao clube.

## O que muda

1. **Convite por pesquisa** — um admin pesquisa um jogador pelo nome (reutilizando o componente `PlayerSearch` e o RPC `search_players` já existentes) e envia-lhe um convite. A pessoa convidada tem de **aceitar** — não é adicionada automaticamente. Vê o convite num novo separador "Convites" em Perfil.jsx e no sino de notificações, tal como já acontece com pedidos de amizade.
2. **Link de convite** — um botão "Copiar link de convite" em GerirClube.jsx → Membros, que gera `${origin}/login?org=<slug>`. Este mecanismo **já existe de ponta a ponta** (`join_organization` RPC, `?org=` capturado em Login.jsx/Home.jsx, consumido por AuthContext após login/signup) — só nunca foi exposto na UI. Ao abrir o link e fazer login ou criar conta, a pessoa entra diretamente no clube, sem aprovação.
3. **Fix relacionado**: `Home.jsx` só tenta o auto-join de `?org=` quando o visitante ainda não tem nenhum clube (`!currentOrganizationId`). Alguém já autenticado e já membro de outro clube que abra um link de convite não é juntado ao novo clube. Como vamos passar a divulgar ativamente estes links, a condição passa a tentar sempre o join (idempotente, não muda o clube atualmente selecionado).

## Decisões

| Questão | Decisão |
| --- | --- |
| Convite por pesquisa exige aceitação? | **Sim.** Espelha o padrão já usado em `friend_requests` — pedido pendente, a pessoa aceita ou recusa. Evita meter alguém num clube sem consentimento. |
| Onde aceitar/recusar | **Novo separador "Convites" em Perfil.jsx**, ao lado de "Amigos". Sino de notificações no header passa a contar também estes convites, com link para lá. |
| Âmbito da pesquisa | Reutiliza `search_players` tal como está — só encontra jogadores que já partilham um clube contigo ou que estão num clube público. Não se constrói pesquisa mais ampla nesta iteração. |
| Link de convite — aprovação | **Nenhuma** — mesmo comportamento que `join_organization` já tem hoje (usado por "juntar por slug" em Home.jsx). Consistente com o pedido: "entra diretamente no grupo". |

## Dados e segurança

Nova tabela `organization_invites`, mesmo padrão RLS que `friend_requests` (sem policy de INSERT — só via RPC `SECURITY DEFINER`):

```sql
CREATE TABLE organization_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (organization_id, invited_user_id)
);
```

- RLS SELECT/DELETE: `invited_user_id = auth.uid() OR is_org_admin(organization_id)` — o convidado recusa (DELETE), o admin também pode cancelar um convite que enviou (DELETE). Mesmo truque que `friend_requests` usa para "recusar" sem RPC dedicado.
- `invite_to_organization(p_organization_id UUID, p_user_id UUID) RETURNS TEXT` — `SECURITY DEFINER`, valida `is_org_admin(p_organization_id)`, recusa se já é membro, faz upsert do convite para `pending` (idempotente — reconvidar depois de recusado só reabre o mesmo registo). Devolve o status resultante.
- `accept_organization_invite(p_invite_id UUID) RETURNS VOID` — `SECURITY DEFINER`, confirma `invited_user_id = auth.uid() AND status = 'pending'`, insere em `memberships`, marca `accepted`.
- `list_incoming_organization_invites() RETURNS TABLE(id, organization_id, organization_name, organization_logo_url, invited_by_name, created_at)` — convites pendentes dirigidos a mim, para o separador Convites e para o sino.
- Sem RPC para recusar — DELETE direto na tabela, coberto pela policy acima (mesmo padrão de `removeFriendRequest`).

## UI

- **GerirClube.jsx → Membros**: novo cartão acima de "Total de membros" com duas ações:
  - `PlayerSearch` (searchFn = `searchPlayers`, `excludeIds` = membros atuais) → ao selecionar, chama `invite_to_organization` e mostra feedback com `alert(...)`, no mesmo padrão já usado neste ficheiro (ex.: "Definições atualizadas com sucesso!").
  - Botão "Copiar link de convite" → copia `${window.location.origin}/login?org=${org.slug}` para o clipboard (`navigator.clipboard.writeText`), com confirmação visual breve.
- **Profile.jsx**: novo separador `{ key: 'convites', label: 'Convites' }`, lista de convites pendentes com avatar/nome do clube + "convidado por X", botões aceitar/recusar — mesmo layout do bloco "Pedidos de amizade" já existente no separador Amigos.
- **Layout.jsx (sino)**: `notificationsTotal` passa a somar também os convites pendentes; nova secção no dropdown, mesmo estilo das secções de pedidos de amizade/pedidos de entrada, a apontar para `/perfil?tab=convites`.
- **Home.jsx**: remover a condição `!currentOrganizationId` do `useEffect` que consome `?org=`, passando a tentar sempre o join quando o parâmetro está presente.

## Fora de âmbito (v1)

- Pesquisa de utilizadores mais ampla (fora do `shares_org_with`/`in_global_org` atual).
- Convites em massa / importação de contactos.
- Expiração ou revogação do link de convite (continua a ser válido enquanto o slug existir, tal como hoje).
- Notificação por WhatsApp do convite — fica só dentro da app.
