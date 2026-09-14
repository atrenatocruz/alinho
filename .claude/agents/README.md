# Agentes de papel (monitorização de processo)

12 subagentes do Claude Code, um por papel, para pedir relatórios de estado e de conformidade com o plano em qualquer altura. Cada um sabe onde procurar (Trello, Notion, ficheiros do repo) e o que "cumprir o plano" significa no seu domínio — ver o ficheiro de cada um para os detalhes.

| Papel | Ficheiro | Foco |
|---|---|---|
| Product Manager | `product-manager.md` | Roadmap/MVPs, GTM, desvios de âmbito |
| Product Owner | `product-owner.md` | Clareza e frescura do backlog Trello |
| Business Analyst | `business-analyst.md` | Rastreabilidade requisito→necessidade, hipóteses por validar |
| UX Designer | `ux-designer.md` | Fluxos, usabilidade, princípios de simplicidade |
| UI Designer | `ui-designer.md` | Consistência visual, design system, copy |
| Developer | `developer.md` | Convenções de código/arquitetura, migrations |
| QA | `qa-engineer.md` | Cobertura de testes, risco de regressão |
| Scrum Master | `scrum-master.md` | Digest cruzado, processo, cadência do ciclo |
| Tech Lead | `tech-lead.md` | Dívida técnica, arquitetura, prontidão para o roadmap |
| Security Reviewer | `security-reviewer.md` | RLS, auth, chave service-role |
| DevOps | `devops-engineer.md` | Deploy real vs repo (bot manual, migrations) |
| Growth/Data Analyst | `growth-analyst.md` | GTM B2B vs B2C, planos, pipeline de instrutores/clubes |

## Como invocar

Pede diretamente pelo nome do papel, por exemplo:
- "pede ao product-owner uma auditoria do backlog"
- "relatório do scrum-master sobre o ciclo atual"
- "o security-reviewer vê esta migration antes de correr"

O `scrum-master` é o único pensado para agregar os outros — pede-lhe um "status geral" quando quiseres uma visão só, em vez de invocar os 11 um a um.

## Notas

- Todos têm acesso total às ferramentas (Trello via browser, Notion via MCP, ficheiros do repo) — nenhum está limitado a leitura, mas todos têm instruções explícitas para **não** editar Trello/Notion/código sem confirmação, já que são superfícies partilhadas.
- São para relatório e deteção de desvios, não para decidir por Francisco/Renato — cada um foi instruído a escalar ambiguidades de estratégia em vez de as resolver sozinho.
- O conteúdo de cada agente reflete o estado do projeto em 2026-08-28 (roadmap MVP1-4, ciclo de duas semanas, board Trello, etc.) — se o roadmap ou a decisão de GTM mudar, vale a pena rever os ficheiros `product-manager.md` e `growth-analyst.md` primeiro, são os que mais dependem de decisões vivas.
