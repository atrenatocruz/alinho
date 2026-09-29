# Registo das atividades de tratamento (RGPD, art. 30.º)

Documento interno, não publicado. Última revisão: 2026-09-29 (Ruben). Atualizar sempre que entra um fornecedor novo, um dado novo ou uma finalidade nova; a política de privacidade pública (`src/locales/*.json`, chaves `privacy.*`) tem de dizer o mesmo que isto.

**Responsável pelo tratamento:** por decidir (empresa ou pessoa singular) — ver `SECURITY_REVIEW.md`. Até lá, contacto: support@alinho.pt.

**Encarregado de proteção de dados:** não obrigatório (sem tratamento em larga escala nem de categorias especiais).

## 1. Tratamentos

| # | Tratamento | Dados | Titulares | Finalidade | Base legal | Retenção | Onde |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Conta e autenticação | nome, email, password (hash, Supabase Auth), data de nascimento, género, foto, mão dominante, lado preferido, idioma, nacionalidade (opcional) | jogadores, admins de clube | prestar o serviço | execução de contrato (art. 6.º/1 b) | enquanto a conta existe; apagada 30 dias após pedido | Supabase (`auth.users`, `profiles`) |
| 2 | Ligação ao WhatsApp | hash HMAC do telefone (`phone_hash`), identificador WhatsApp (`whatsapp_jid`) dos convidados e de quem confirma o número, código de confirmação (15 min) | jogadores que usam o bot | inscrições e lembretes pelo WhatsApp; juntar conta de convidado à conta real | execução de contrato | idem; o hash é apagado na eliminação | Supabase (`profiles`, `phone_verifications`), Edge Function `hash-phone` (segredo `PHONE_HASH_SECRET`), bot na AWS EC2 |
| 3 | Jogos e resultados | inscrições, saídas, duplas, resultados, pontos, nível (rating), histórico por mix/jogo/torneio, eventos de inscrição (origem app/bot) | jogadores | organizar jogos, calcular rankings | execução de contrato; interesse legítimo para manter resultados anonimizados após eliminação (integridade dos rankings dos outros) | resultados ficam anonimizados («Jogador removido») após eliminação | Supabase |
| 4 | Social | kudos, seguidores/pedidos, convites de clube, notificações, conquistas, XP, vouchers | jogadores | funcionalidades sociais e de incentivo | execução de contrato | apagados na eliminação | Supabase |
| 5 | Aulas | inscrições em aulas/turmas, presenças, preços por inscrição | alunos, professores | gestão de aulas do clube | execução de contrato | idem | Supabase |
| 6 | Emails transacionais | email, nome, conteúdo do email (confirmação, recuperação, convite, boas-vindas) | jogadores | comunicar sobre a conta | execução de contrato | logs do fornecedor (Resend) | Resend (UE), SMTP no Supabase Auth |
| 7 | Anti-abuso no login | endereço IP, dados do browser, token do captcha | quem faz login/registo | impedir registos automáticos | interesse legítimo | não guardado por nós; retenção do fornecedor | Cloudflare Turnstile; Supabase Auth (rate limits) |
| 8 | Suporte | emails recebidos em support@alinho.pt | quem escreve | responder a pedidos, incluindo direitos RGPD | interesse legítimo / obrigação legal (direitos) | enquanto o pedido estiver aberto + 1 ano | Cloudflare Email Routing → Gmail da equipa |
| 9 | Consentimento e termos | data de aceitação da política e dos termos | jogadores | prova de consentimento | obrigação legal | enquanto a conta existe | Supabase (`profiles`) |
| 10 | Bot de WhatsApp — leitura do grupo | mensagens do grupo (só em memória, para reconhecer comandos); guarda só In/Out/resultados e o nome de WhatsApp de quem escreve | membros dos grupos de WhatsApp dos clubes | reconhecer comandos | execução de contrato (o clube pede o bot; os membros são informados na descrição do grupo) | mensagens não guardadas; eventos como em 3 | bot na AWS EC2 (Baileys, sem API oficial da Meta), sessão do WhatsApp em disco na instância |
| 11 | Contas de teste e sintéticas | contas `@padelapp.test` criadas por admins para testar mixes | — | testes | — | apagáveis pelo admin | Supabase |

## 2. Subcontratantes

| Fornecedor | Serviço | Localização | Contrato |
| --- | --- | --- | --- |
| Supabase | base de dados, auth, storage, edge functions | região do projeto: **confirmar no dashboard** (UE ou não) | DPA standard (aceitar no painel e guardar cópia) |
| Vercel | alojamento da app web | edge global; build/serverless nos EUA salvo configuração | DPA standard |
| Resend | envio de emails | UE (domínio `alinho.pt` criado na região EU) | DPA standard |
| Cloudflare | DNS, Turnstile (captcha), Email Routing | global | DPA standard |
| Amazon Web Services | EC2 do bot de WhatsApp | região da instância: **confirmar** | DPA standard (AWS Data Processing Addendum) |
| Google | login OAuth; Places API (autocomplete de moradas de clubes, sem dados pessoais) | EUA/global | termos Google Cloud |
| Meta/WhatsApp | canal usado pelo bot (biblioteca não-oficial) | — | não há contrato: risco contratual assumido, declarado na política |

Transferências para fora da UE: dependem das regiões acima; se alguma for fora da UE, aplicam-se as cláusulas contratuais-tipo dos fornecedores e a política pública tem de o dizer.

## 3. Direitos dos titulares

- Acesso, retificação: na app (Perfil) ou por email.
- Apagamento: na app (Perfil → Apagar a minha conta, 30 dias) ou por email, feito por um administrador da plataforma (`admin_delete_account`).
- Portabilidade: por email; exportação manual a partir da base de dados.
- Oposição/limitação: por email, caso a caso.
- Prazo de resposta: 1 mês (art. 12.º).

## 4. Menores

- Idade mínima para criar conta: 13 anos (Lei 58/2019, art. 16.º), validada no registo e no primeiro acesso das contas Google.
- 13–17: conta privada por omissão (`is_private`).
- Convidados criados pelo bot a partir do WhatsApp: idade desconhecida; só passam a conta completa quando se registam, altura em que a idade é pedida.

## 5. Segurança (resumo)

RLS em todas as tabelas; chave de serviço só no bot e nas edge functions; telefone só como hash HMAC com segredo fora da base; HTTPS/HSTS; captcha no login; ver `SECURITY_REVIEW.md` para o detalhe e para o procedimento de violação de dados.
