#!/usr/bin/env node
/**
 * SessionStart hook — injecta no contexto do Claude o estado actual do trabalho
 * da equipa, em todos os boards configurados, para que ninguém pegue numa task
 * que já está a ser feita.
 *
 * Com TRELLO_API_KEY + TRELLO_TOKEN no ambiente lê os boards directamente.
 * Sem credenciais, devolve uma instrução para o Claude os ler pelo conector MCP.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, '..', 'team', 'board.json'), 'utf8'));

const KEY = process.env.TRELLO_API_KEY;
const TOKEN = process.env.TRELLO_TOKEN;

// Listas que respondem a "quem está a fazer o quê" e "o que espera por mim".
const WATCH = ['In Development', 'Code Review', 'Dev Done'];

function emit(text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
  }));
}

const days = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

async function listCards(listId) {
  const url = new URL(`https://api.trello.com/1/lists/${listId}/cards`);
  url.searchParams.set('key', KEY);
  url.searchParams.set('token', TOKEN);
  url.searchParams.set('fields', 'idShort,name,shortUrl,dateLastActivity');
  url.searchParams.set('members', 'true');
  url.searchParams.set('member_fields', 'username');
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Trello ${res.status} na lista ${listId}`);
  return res.json();
}

const boards = Object.entries(cfg.boards);
const boardsLine = boards.map(([k, b]) => `${b.label} — commits \`(${b.commitPrefix} #N)\` — ${b.boardUrl}`).join('\n  ');

if (!KEY || !TOKEN) {
  emit(
    'ESTADO DA EQUIPA — não lido automaticamente (falta TRELLO_API_KEY/TRELLO_TOKEN no .env).\n' +
    `Boards da equipa:\n  ${boardsLine}\n\n` +
    'Antes de começares trabalho de task, lê pelo conector MCP do Trello as listas ' +
    '"In Development", "Code Review" e "Dev Done" de cada board, e diz ao utilizador o que já ' +
    'está a ser feito por outra pessoa e o que está à espera de review. Não pegues numa task ' +
    'que já tenha alguém atribuído.'
  );
  process.exit(0);
}

try {
  const out = [];
  for (const [key, board] of boards) {
    const blocks = [];
    for (const name of WATCH) {
      const listId = board.lists?.[name];
      if (!listId) continue; // lista não existe neste board
      const cards = await listCards(listId);
      if (!cards.length) { blocks.push(`  ${name}: (vazio)`); continue; }
      const lines = cards.map((c) => {
        const who = c.members?.map((m) => m.username).join(', ') || 'SEM DONO';
        const age = days(c.dateLastActivity);
        const stale = age >= 3 ? `  ⚠ parado há ${age}d` : '';
        return `    ${board.commitPrefix} #${c.idShort} ${c.name} — ${who}${stale}\n      ${c.shortUrl}`;
      });
      blocks.push(`  ${name}:\n${lines.join('\n')}`);
    }
    out.push(`${board.label}  (${key})\n${blocks.join('\n') || '  (sem listas configuradas)'}`);
  }
  emit(
    'ESTADO DA EQUIPA (lido no arranque da sessão):\n\n' +
    out.join('\n\n') +
    '\n\nRegras: não pegues numa task que já tenha alguém atribuído em "In Development". ' +
    'Cartões em "Code Review" esperam que alguém os reveja (/rever). Cartões em "Dev Done" ' +
    `esperam a promoção de ${cfg.git.workBranch}→${cfg.git.releaseBranch}, que é do ${cfg.git.promoter}. ` +
    'Usa /pegar para claimar uma task, /entregar quando acabares. ' +
    'Cada board tem o seu prefixo de commit — usa o do board a que a task pertence.'
  );
} catch (err) {
  emit(
    `ESTADO DA EQUIPA — falhou a leitura dos boards (${err.message}).\n` +
    `Boards da equipa:\n  ${boardsLine}\n` +
    'Lê-os pelo conector MCP do Trello antes de começares.'
  );
}
