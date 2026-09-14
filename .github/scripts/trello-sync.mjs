#!/usr/bin/env node
/**
 * Sincroniza os boards Trello da equipa com o que realmente aconteceu no git.
 *
 * Corre no GitHub Actions, não na máquina de ninguém — é por isso que é a parte
 * fiável do fluxo: o cartão move-se quando o código chega ao sítio, mesmo que
 * ninguém se tenha lembrado de o mover.
 *
 *   push para a work branch    (dev)  → cartão avança até "Dev Done"
 *   push para a release branch (main) → cartão vai para "Testing - QA"
 *
 * Um cartão só avança na ordem definida em flow.order — nunca recua.
 *
 * Vários boards: cada board tem o seu prefixo de commit, definido em
 * `.claude/team/board.json`. "(Trello #51)" → board alinho; "(Bot #12)" → board bot.
 *
 * Ambiente: TRELLO_API_KEY, TRELLO_TOKEN, SLACK_BOT_TOKEN,
 *           BRANCH, COMMIT_RANGE, REPO_URL
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync('.claude/team/board.json', 'utf8'));
const { TRELLO_API_KEY: KEY, TRELLO_TOKEN: TOKEN, SLACK_BOT_TOKEN: SLACK } = process.env;
const BRANCH = process.env.BRANCH || '';
const RANGE = process.env.COMMIT_RANGE || 'HEAD~1..HEAD';
const REPO_URL = process.env.REPO_URL || '';

if (!KEY || !TOKEN) {
  console.log('Sem credenciais do Trello — nada a fazer.');
  process.exit(0);
}

const ORDER = cfg.flow.order;
const TARGET = BRANCH === cfg.git.releaseBranch
  ? cfg.flow.onPushToReleaseBranch
  : cfg.flow.onPushToWorkBranch;
const IS_RELEASE = BRANCH === cfg.git.releaseBranch;

async function trello(path, { method = 'GET', params = {} } = {}) {
  const url = new URL(`https://api.trello.com/1${path}`);
  url.searchParams.set('key', KEY);
  url.searchParams.set('token', TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { method });
  if (!res.ok) throw new Error(`Trello ${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function slack(channelKey, text) {
  if (!SLACK) return;
  const channel = cfg.slack[channelKey] || cfg.slack.devUpdates;
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { authorization: `Bearer ${SLACK}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text, unfurl_links: false }),
  });
  const body = await res.json();
  if (!body.ok) console.log(`Slack recusou (${channelKey}): ${body.error}`);
}

// --- commits deste push ---------------------------------------------------
let commits = [];
try {
  commits = execSync(`git log --no-merges --format=%h%x09%s ${RANGE}`, { encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .map((l) => { const [sha, ...s] = l.split('\t'); return { sha, subject: s.join('\t') }; });
} catch (err) {
  console.log(`Não consegui ler o range ${RANGE}: ${err.message}`);
  process.exit(0);
}

// --- que cartões, de que board, referem estes commits ---------------------
// Apanha "(Trello #51)" e as formas encadeadas que o repo já usa:
// "(Trello #102 + #37)", "(Trello #164, #165)".
const prefixToBoard = new Map(
  Object.entries(cfg.boards).map(([key, b]) => [b.commitPrefix.toLowerCase(), key]),
);
for (const p of prefixToBoard.keys()) {
  // o prefixo entra num regex — mantém-no simples em vez de o escapar
  if (!/^[a-z0-9_-]+$/i.test(p)) throw new Error(`commitPrefix inválido em board.json: "${p}"`);
}
const CARD_REF = new RegExp(
  `(${[...prefixToBoard.keys()].join('|')})` + String.raw`\s*#\d+(?:\s*(?:[,+&/]|e|and)\s*#\d+)*`,
  'gi',
);

/** boardKey → Map(cardNumber → [commits]) */
const byBoard = new Map();
for (const c of commits) {
  for (const m of c.subject.matchAll(CARD_REF)) {
    const boardKey = prefixToBoard.get(m[1].toLowerCase());
    if (!byBoard.has(boardKey)) byBoard.set(boardKey, new Map());
    const cards = byBoard.get(boardKey);
    for (const n of [...m[0].matchAll(/#(\d+)/g)].map((x) => Number(x[1]))) {
      if (!cards.has(n)) cards.set(n, []);
      cards.get(n).push(c);
    }
  }
}

if (!byBoard.size) {
  const orphans = commits.map((c) => `\`${c.sha}\` ${c.subject}`).join('\n');
  console.log(`Nenhum commit refere um cartão. Commits:\n${orphans || '(nenhum)'}`);
  if (commits.length && IS_RELEASE) {
    await slack('devUpdates',
      `⚠️ ${commits.length} commit(s) chegaram a \`${BRANCH}\` sem referência a cartão — ` +
      `nenhum board sabe deles.\n${orphans}`);
  }
  process.exit(0);
}

// --- mover os cartões, board a board -------------------------------------
let moved = 0;
for (const [boardKey, cardNumbers] of byBoard) {
  const board = cfg.boards[boardKey];
  const targetListId = board.lists?.[TARGET];
  if (!targetListId) {
    console.log(`[${boardKey}] a lista "${TARGET}" não está configurada — nada a mover.`);
    continue;
  }

  const cards = await trello(`/boards/${board.boardId}/cards`, {
    params: { fields: 'idShort,name,shortUrl,idList' },
  });
  const listName = Object.fromEntries(
    Object.entries(board.lists).filter(([, id]) => id).map(([n, id]) => [id, n]),
  );

  for (const [n, cs] of cardNumbers) {
    const card = cards.find((c) => c.idShort === n);
    if (!card) { console.log(`[${boardKey}] cartão #${n} não encontrado (arquivado?).`); continue; }

    const from = listName[card.idList] || '(lista desconhecida)';
    const shas = cs.map((c) => c.sha).join(', ');
    const shouldMove = ORDER.indexOf(from) < ORDER.indexOf(TARGET);

    await trello(`/cards/${card.id}/actions/comments`, {
      method: 'POST',
      params: {
        text:
          `🤖 \`${BRANCH}\` recebeu ${cs.length} commit(s) deste cartão: ${shas}\n` +
          cs.map((c) => `- ${c.subject}`).join('\n') +
          (REPO_URL ? `\n${REPO_URL}/commits/${BRANCH}` : '') +
          (shouldMove ? `\n→ movido de **${from}** para **${TARGET}**.`
                      : `\n(deixado em **${from}** — já está à frente de ${TARGET}.)`),
      },
    });

    if (shouldMove) {
      await trello(`/cards/${card.id}`, { method: 'PUT', params: { idList: targetListId } });
      moved++;
      console.log(`[${boardKey}] #${n} ${card.name}: ${from} → ${TARGET}`);
    } else {
      console.log(`[${boardKey}] #${n} ${card.name}: mantido em ${from}`);
    }

    const ch = board.slackChannel || 'devUpdates';
    if (IS_RELEASE) {
      await slack(ch,
        `🚀 ${board.commitPrefix} #${n} ${card.name} está em \`${BRANCH}\` — pronto para QA\n` +
        `${card.shortUrl}\ncommits: ${shas}`);
    } else if (shouldMove) {
      await slack(ch,
        `📦 ${board.commitPrefix} #${n} ${card.name} → *${TARGET}* (commits em \`${BRANCH}\`)\n` +
        `${card.shortUrl}\ncommits: ${shas}`);
    }
  }
}
console.log(`Feito: ${moved} cartão(ões) movido(s) para ${TARGET}.`);
