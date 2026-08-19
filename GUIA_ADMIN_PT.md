# Guia do Administrador — alinho

Guia para quem administra um clube ou grupo na alinho.

## Responsabilidades do admin

Como administrador de um clube, podes:
- Criar, editar e eliminar jogos (mixes)
- Ativar recorrência num mix, para que se repita automaticamente
- Gerir membros: promover/remover admins, remover membros
- Aprovar ou rejeitar pedidos de entrada (se o clube for público mas não de entrada livre)
- Configurar definições do clube (nome, sistema de pontos, visibilidade pública)

## Aceder ao painel de gestão

1. Entra na app com a tua conta
2. Clica em **Gerir** na barra inferior
3. Se geres mais do que um clube, escolhe qual — caso contrário entras diretamente
4. Dentro de um clube verás três separadores: **Jogos**, **Membros** e **Definições**

## Gerir jogos

### Criar um novo jogo

1. Separador **Jogos** → **Criar novo jogo**
2. Preenche título, data e hora, local, preço por jogador, prémio, número de campos, tempo de court, tempo de jogo e formato
3. Opcionalmente, ativa **Mix recorrente** e define a frequência, quando termina, e quantos dias/horas antes o próximo mix deve ser lançado automaticamente
4. **Criar**

### Editar ou eliminar um jogo

Ícones de editar/eliminar em cada jogo na lista. Eliminar não pode ser desfeito — se já houver jogadores inscritos, avisa-os antes.

### Estados dos jogos

- **Aberto** — jogadores podem entrar
- **Fechado** — campo reservado, número de jogadores atingido
- **Pendente** — uma ocorrência futura de um mix recorrente, ainda não lançada
- **A decorrer** — jogo em curso
- **Terminado** — jogo já realizado
- **Cancelado**

### Suplentes

Quando um jogo enche, mais inscrições entram numa lista de espera e são promovidas automaticamente à medida que vagas abrem.

## Gerir membros

No separador **Membros** vês todos os membros do clube, com nome, nível e estado de admin, mais os pedidos de entrada pendentes (se aplicável).

- **Tornar/retirar admin**: botão junto a cada membro.
- **Remover um membro**: ícone de remoção junto a cada membro — a conta e as estatísticas dele noutros clubes mantêm-se, isto só remove a ligação a este clube.

## Definições do clube

- **Nome do grupo**
- **Sistema de pontos**: pontos por jogo disputado, por jogo ganho, por participar num mix, por ganhar o mix — só afeta mixes finalizados a partir do momento da alteração
- **Clube público**: aparece em "Clubes & Grupos", conta para o ranking geral, e os membros ficam pesquisáveis por qualquer jogador
- **Entrada livre**: se o clube for público, controla se quem pede para entrar é aprovado automaticamente ou fica pendente da tua aprovação

## Boas práticas

- Cria jogos com alguma antecedência e com título/local claros
- Não elimines jogos com jogadores já inscritos sem avisar
- Tem pelo menos 2 admins ativos por clube
- Dá permissões de admin só a quem precisa

## Perguntas frequentes

**Quantos admins devo ter?** Recomenda-se 2-3 admins ativos.

**Posso reverter um resultado depois de submetido?** Não diretamente pela app — contacta quem tem acesso ao painel Supabase.

**Como adiciono novos membros?** Partilha o link do clube (ou o link de convite, se configurado) — eles registam-se e ficam associados automaticamente.

**A app funciona offline?** Parcialmente — instala como PWA (ecrã principal do telemóvel) para a melhor experiência.

**Existe um bot de WhatsApp?** Sim, por clube — publica o roster do mix no grupo e sincroniza respostas "In"/"Out"/"Fora" com a app. Precisa de ser configurado à parte (não faz parte deste guia — fala com quem gere a infraestrutura técnica do teu clube).
