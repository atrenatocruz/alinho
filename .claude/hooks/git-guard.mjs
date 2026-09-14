#!/usr/bin/env node
/**
 * Hook de git, dois papéis (decide pelo hook_event_name recebido no stdin):
 *
 *  PreToolUse  — recusa qualquer push para `main`. A regra "só o Renato promove
 *                dev→main" está escrita no CLAUDE.md; aqui passa a ser aplicada.
 *  PostToolUse — depois de um push bem sucedido, lembra o Claude de fechar o
 *                ciclo no Trello + Slack em vez de o deixar para o fim (ou nunca).
 */
import { readFileSync } from 'node:fs';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const event = payload.hook_event_name || '';
const cmd = payload.tool_input?.command || '';

const isGitPush = /\bgit\s+push\b/.test(cmd);
// push para main, em qualquer das formas que o CLAUDE.md nomeia
const pushesMain = isGitPush && /\b(origin\s+(main|[^\s]+:main)|--all)\b/.test(cmd);

if (event === 'PreToolUse') {
  if (pushesMain) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Push para `main` bloqueado pelo fluxo da equipa: promover dev→main é decisão e mão ' +
          'do Renato (ver CLAUDE.md e TEAMWORK.md). Faz push para `dev`, corre /entregar para ' +
          'pôr o cartão em Code Review, e avisa no #dev-updates que está pronto a promover.',
      },
    }));
    process.exit(0);
  }
  process.exit(0);
}

if (event === 'PostToolUse' && isGitPush) {
  const branch = (/\bgit\s+push\s+\S+\s+(\S+)/.exec(cmd)?.[1] || 'dev').replace(/^.*:/, '');
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        `Acabaste de fazer push (${branch}). Antes de dar a task como terminada, fecha o ciclo de ` +
        'equipa — corre /entregar, ou em alternativa faz manualmente: (1) comentário no cartão ' +
        'Trello com o que foi feito e os SHAs, (2) mover o cartão para Code Review, (3) mensagem ' +
        'no Slack #dev-updates com número do cartão, link e resumo em termos de desenvolvimento. ' +
        'Salta isto apenas se o utilizador disser que está com poucos tokens.',
    },
  }));
}
