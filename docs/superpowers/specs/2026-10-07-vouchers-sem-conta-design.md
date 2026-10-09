# Vouchers também para quem não tem conta — design

**Data:** 7 out 2026 · **Pedido:** Renato · **Estado:** aprovado em conversa (Renato, 7 out — «sim já falei [com o Francisco], ponto 3 tb ok»)

## Porquê

Quem ganha um mix sem estar na app hoje não fica com voucher nenhum — e o clube não fica a saber que essa pessoa ganhou. O clube precisa de ver **todos** os vouchers de **todos** os vencedores, com ou sem conta, para os gerir na receção.

Isto desfaz a decisão do Francisco de 30 set (`migration_vouchers_so_com_conta.sql`: «só damos o voucher se tiver conta»). O Renato falou com ele antes (7 out). O receio de então — a pessoa usa o voucher, cria conta, e o voucher reaparece por usar — fica tratado no ponto 4.

## O que muda (comportamento)

1. **Todos os vencedores de um mix com voucher (`games.has_voucher`) recebem voucher**: quem tem conta, os perfis sem conta antigos (convidados `guest-…@whatsapp.alinho.pt`, participantes `…@padelapp.test`, parceiros `…@invalid.alinho.pt`) e os convidados sem conta novos (`game_guests`, sem perfil). Deixa de haver o filtro `voucher_eligible`. Os torneios continuam sem vouchers.
2. **Lista do clube (Gerir clube → Vouchers):** cada voucher de quem não tem conta mostra, por baixo do nome, a nota *«Este jogador não está na app. Confirma quem é na receção antes de dar baixa.»* (en: *«This player isn't on the app. Check who they are at reception before redeeming.»*). «Dar baixa» funciona igual (já funciona sem conta desde 27 set).
3. **Correção de resultado depois de terminado** (mix normal e americano): os vouchers sem conta seguem a mesma regra dos com conta — os da dupla que deixou de ganhar saem se ainda estiverem por usar; os usados ficam; a dupla nova recebe.
4. **Um voucher sem conta nunca passa para uma conta.**
   - Convidados novos (`game_guests`): já é assim por construção — a adoção ao confirmar o número só apanha mixes ainda por sortear; um mix terminado nunca é adotado. O voucher fica ligado ao convidado, não a um perfil.
   - Convidados antigos com perfil (`guest-…`): o `juntar_convidado` (hoje só manual, saiu da confirmação do número a 1 out) passa a **anular** os vouchers por usar do convidado antes de mover o resto, com a razão *«Criado sem conta: gerido pelo clube, não passa para a conta.»* Os usados passam como histórico. (O `arquivo_537.desfazer` não reativa estes vouchers — volta-se à mão, se alguma vez for preciso.)
5. **Vouchers antigos:** os anulados a 30 set (produção: 1) ficam como estão. Nada retroativo.
6. **Aviso do robô (`voucherNotices.js`):** sem mudança de código. Com o filtro fora, os convidados `guest-…` voltam a receber o aviso no grupo (era a intenção de 27 set). Os convidados `game_guests` **não** são avisados — fica como seguimento possível (têm `whatsapp_jid`), fora deste trabalho.

## Dados

`vouchers` ganha:

| coluna | tipo | nota |
|---|---|---|
| `user_id` | passa a **nullable** | |
| `guest_id` | `UUID REFERENCES game_guests(id) ON DELETE SET NULL` | o convidado sem conta |
| `guest_name` | `TEXT` | o nome no momento do voucher — sobrevive ao convidado ser apagado |

- `CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL)` — um voucher é sempre de alguém.
- Índice único parcial `(game_id, guest_id) WHERE guest_id IS NOT NULL` (o `UNIQUE (game_id, user_id)` já existente não colide com `NULL`).

**RLS:** a política de SELECT (`user_id = auth.uid() OR shares_org_with(user_id)`) não muda. Com `user_id` nulo nenhum browser lê o voucher diretamente — o admin vê-os só pela `list_club_vouchers` (SECURITY DEFINER, já exige `is_admin` no clube). Escrita continua só por funções SECURITY DEFINER. Nenhuma superfície nova aberta ao browser.

## Funções

- **Nova `award_mix_vouchers(p_game_id UUID, p_winner_team_id UUID)`** (SECURITY DEFINER, sem acesso de `PUBLIC/anon/authenticated`): dá voucher aos dois lugares da dupla — `player1_id/player2_id` (conta) e `player1_guest_id/player2_guest_id` (com `guest_name` copiado de `game_guests.name`); idempotente (`NOT EXISTS`). Não verifica `has_voucher` — quem a chama já verifica.
- **Nova `revoke_unused_mix_vouchers_of_guests(p_game_id UUID, p_winner_team_id UUID)`** (mesmas permissões): apaga os vouchers **por usar** de convidados deste jogo que não estão na dupla vencedora. Só as correções a chamam (as linhas com `user_id` já são tratadas pelo laço que existe).
- **Trocas no corpo vivo** (padrão do repo: ler `pg_get_functiondef`, trocar o pedaço, recusar se não aparecer exatamente 1 vez, «já estava» se já trocado):
  - cada função cujo corpo vivo tem `INSERT INTO vouchers` — esperadas: `finalize_mix`, `correct_finished_mix_match`, e as do americano se as tiverem (`finalize_americano_mix`, `correct_finished_americano_match`). O bloco `INSERT INTO vouchers … ON CONFLICT (game_id, user_id) DO NOTHING;` passa a `PERFORM award_mix_vouchers(<jogo>, <dupla>);`, guardando os argumentos que já lá estavam. Nas correções, junta-se antes `PERFORM revoke_unused_mix_vouchers_of_guests(...)`. A migração lista os nomes encontrados e para se encontrar uma função que não espera.
  - `juntar_convidado` (se existir): anula os vouchers por usar do convidado antes de mover as linhas (ponto 4).
- **`list_club_vouchers`**: muda o tipo de retorno → `DROP` + `CREATE` na mesma transação, permissões repostas como estavam (`authenticated` sim; `PUBLIC`/`anon` não). `JOIN profiles` → `LEFT JOIN`; `player_name = COALESCE(p.name, v.guest_name)`; coluna nova `has_account BOOLEAN` = `v.user_id IS NOT NULL AND voucher_eligible(v.user_id)`; mantém o filtro `status <> 'anulado'` e a regra do contacto.

## Ecrã

- `VouchersAdmin.jsx`: nota por baixo do nome quando `has_account === false` (tom de aviso discreto, como os outros avisos da lista). Antes da migração a coluna não vem → `undefined` → sem nota (compatível).
- `src/locales/pt.json` + `en.json`: chave nova.
- `devMockVouchers.js`: um voucher de convidado sem conta no mock, para se ver no dev.
- Verificar que nenhum outro sítio que lê vouchers (`Profile.jsx`, `GameDetails.jsx`, `src/lib/vouchers.js`) parte com `user_id` nulo.

## Implementação e entrega

- Uma migração: `supabase/migration_vouchers_para_todos.sql`, numa transação, que se pode correr mais do que uma vez, com as queries de verificação no fim. **Correr à mão no SQL Editor: primeiro dev (jnrdbf…), depois produção antes de o código ir para `main`.** O ecrã aguenta estar no ar antes da migração (sem nota), por isso a ordem não parte nada. Mas sem a migração não há vouchers novos sem conta.
- Robô: nada a reinstalar.

## Testes

- SQL no dev, depois de correr: um mix com voucher, com um convidado sem conta na dupla vencedora → terminar → 2 vouchers (um `user_id`, um `guest_id` + `guest_name`); correr outra vez → continuam 2; corrigir o resultado para outra dupla → o do convidado por usar sai, a dupla nova recebe; `list_club_vouchers` devolve o convidado com `has_account = false`.
- Vitest: as funções de `src/lib/vouchers.js` que o ecrã usa, se a forma da linha mudar.
- No browser (dev): lista do clube mostra a nota no voucher sem conta e «Dar baixa» funciona.

## Fora deste trabalho

Aviso do robô aos convidados `game_guests`; vouchers em torneios; reativar o voucher anulado a 30 set.
