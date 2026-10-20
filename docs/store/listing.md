# Ficha das lojas (Google Play e App Store)

Rascunho de 20 out 2026. Regra do PRODUCT.md: sem números inventados, sem
testemunhos, sem «milhares de jogadores». Só o que a app faz hoje.

Imagens em `docs/store/android/`:
- `icon-512.png`: ícone da loja (512×512).
- `feature-graphic-1024x500.png`: imagem de destaque da Play Store.
- `screenshots-provisorias/`: 1080×2160, tiradas no emulador com a sessão
  fictícia de desenvolvimento («Dev Org», «Admin (Dev)»). **Substituir** pelas
  do clube de demonstração antes de publicar em produção. Para o teste
  fechado chegam.

## Português (Portugal) · idioma principal

**Nome da app** (máx. 30): `alinho: padel em grupo`

**Descrição curta** (Play, máx. 80):
`Mixes, torneios e o teu nível de padel, com o grupo do WhatsApp de sempre.`

**Subtítulo** (App Store, máx. 30): `Mixes, torneios e o teu nível`

**Descrição completa:**

> Os teus jogos de padel, finalmente organizados.
>
> O alinho junta num só sítio o que hoje anda espalhado por grupos de WhatsApp e folhas de cálculo: quem joga, quando, onde e com que nível.
>
> **Para quem joga**
> • Vê os mixes e jogos dos teus grupos e clubes e entra com um toque, sozinho ou com parceiro.
> • Não queres abrir a app? Responde «In» no grupo do WhatsApp e o robô do alinho inscreve-te.
> • O teu nível sobe e desce com cada resultado. Vês a tua posição no ranking do grupo e do clube.
> • Inscreve-te em torneios e acompanha os jogos e os resultados.
> • Marca jogos entre amigos fora do clube e regista o resultado.
>
> **Para quem organiza**
> • Cria mixes num minuto, com o formato, os campos, o nível e o preço.
> • As inscrições, as listas de espera e os pares fazem-se sozinhos.
> • Os resultados alimentam o ranking do grupo, sem contas à mão.
>
> Grátis para quem joga. Em português.
>
> Tens dúvidas ou sugestões? Escreve-nos para support@alinho.pt.

**Palavras-chave** (App Store, máx. 100, separadas por vírgulas):
`padel,mix,torneio,ranking,nível,clube,jogos,whatsapp,grupo,americano`

**Categoria:** Desporto · **Classificação etária:** para todos (sem conteúdos
sensíveis; tem perfis públicos e mensagens de grupo, o que o questionário pergunta)

**Contactos e links**
- Email de suporte: support@alinho.pt
- Site: https://www.alinho.pt
- Política de privacidade: https://www.alinho.pt/privacidade
- Apagar a conta: https://www.alinho.pt/apagar-conta (só fica ativo quando chegar ao `main`)

## English

**App name:** `alinho: padel with your group`

**Short description:**
`Padel mixes, tournaments and your level, with your usual WhatsApp group.`

**Subtitle (App Store):** `Mixes, tournaments, your level`

**Full description:**

> Your padel games, finally organised.
>
> alinho brings together what's usually scattered across WhatsApp groups and spreadsheets: who's playing, when, where, and at what level.
>
> **For players**
> • See the mixes and games from your groups and clubs and join with one tap, solo or with a partner.
> • Don't want to open the app? Reply «In» in the WhatsApp group and the alinho bot signs you up.
> • Your level goes up and down with every result. See where you stand in your group's and club's rankings.
> • Sign up for tournaments and follow the matches and results.
> • Set up games with friends outside the club and record the score.
>
> **For organisers**
> • Create a mix in a minute, with format, courts, level and price.
> • Sign-ups, waiting lists and pairings sort themselves out.
> • Results feed the group ranking, no spreadsheets.
>
> Free for players.
>
> Questions or ideas? Write to support@alinho.pt.

## Segurança dos dados (Play) / Privacidade (Apple): o que declarar

Com base em `/privacidade` e no código. A confirmar pela BA antes de submeter.

| Dado | Recolhido | Para quê | Partilhado | Obrigatório |
|---|---|---|---|---|
| Nome, email | sim | conta, funcionamento da app | não | sim |
| Data de nascimento, género | sim | categorias e rankings | não | sim |
| Telemóvel | sim | ligar ao robô do WhatsApp | não | não |
| Foto de perfil | sim | perfil | não | não |
| Resultados e jogos | sim | ranking, histórico | não | sim |
| Localização aproximada | só se a pessoa tocar em «Usar a minha localização» ou abrir o mapa; pelo código, fica no telemóvel (filtra/ordena por distância). **Confirmar que não vai para o servidor**: se ficar só no aparelho, a Google não a conta como «recolhida» | filtrar jogos perto | não | não |
| Publicidade, analytics de terceiros | **não** | | | |

- Dados encriptados em trânsito: sim (HTTPS).
- A pessoa pode pedir para apagar: sim, na app (Perfil) e em alinho.pt/apagar-conta.
