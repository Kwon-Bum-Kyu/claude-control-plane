#!/usr/bin/env node
// CCP — router-suggest hook (B19, Phase 6-A v0.2)
// Event: UserPromptSubmit
// Behavior: classify the user prompt with the 4-axis router and inject a delegation
//   suggestion as a system reminder.
//   If the decision is 'claude', noop (main handling). If 'gemini' or 'codex',
//   inject only the suggestion message.
// Never auto-delegates: it does not auto-delegate; the user reviews the suggestion
//   and calls the slash command directly.
//   (Principle 4 — _workspace/02_arch_decisions.md "no automatic fallback")
// Failure-silent: the hook does not block input — on parse failure or exception,
//   exit with empty output.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUMMARY_MAX_CHARS = 500;
const SLASH_HINT = {
  gemini: '/gemini:rescue',
  codex: '/ccp:codex-rescue',
};

// B21-3 (2026-05-03) — warn against meta-bypass when headless automation is suspected.
// Intended to block the 12 meta-bypass cases reported in B9 §8.5.4
// (Skill→Agent→companion→direct CLI).
// If there is no sign of a direct user slash call and automation keywords appear,
// append one recommended pattern line.
const HEADLESS_HINT = /headless|claude\s*-p|\uC2A4\uD06C\uB9BD\uD2B8|\uC790\uB3D9\uD654|automation|cron|CI/i;
const SLASH_PRESENT = /\/(?:ccp:codex-|gemini:|ccp:gemini-)/;

function isLikelyHeadless(promptText) {
  if (SLASH_PRESENT.test(promptText)) return false;
  return HEADLESS_HINT.test(promptText);
}

function readStdinSync() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

function clamp(text) {
  if (!text) return '';
  return text.length <= SUMMARY_MAX_CHARS
    ? text
    : text.slice(0, SUMMARY_MAX_CHARS - 16) + '...(truncated)';
}

function buildMessage(decision, headlessSuspected) {
  const slash = SLASH_HINT[decision.target];
  if (!slash) return null;

  const tokenInfo = decision.tokens != null ? ` (~${decision.tokens.toLocaleString()} tok)` : '';
  const matched = Array.isArray(decision.matched) && decision.matched.length > 0
    ? ` [matched: ${decision.matched.slice(0, 3).join(', ')}]`
    : '';
  const reason = decision.reason || 'unknown';

  const baseLine =
    `[CCP-ROUTER-001] Router suggestion: ${decision.target} (axis ${decision.axis}, ${reason})${tokenInfo}${matched}. ` +
    `Delegate with \`${slash} "<task>"\` if needed. No automatic delegation is performed.`;

  if (!headlessSuspected) return clamp(baseLine);

  const companionScript = decision.target === 'codex' ? 'codex-companion.mjs' : 'gemini-companion.mjs';
  const headlessLine =
    ` [CCP-META-WARN] Possible headless usage: instead of meta exploration (\`--help\`, bypassing \`Skill\`→\`Agent\`), ` +
    `directly run \`node plugins/ccp/scripts/${companionScript} rescue --task <task>\`.`;

  return clamp(baseLine + headlessLine);
}

async function main() {
  let payload = {};
  const raw = readStdinSync().trim();
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      return emit({});
    }
  }

  const prompt = payload.prompt || payload.user_prompt || payload.input || '';
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return emit({});
  }

  let classify;
  try {
    const routerPath = resolve(__dirname, '..', 'scripts', 'lib', 'router.mjs');
    ({ classify } = await import(routerPath));
  } catch {
    return emit({});
  }

  let decision;
  try {
    decision = classify(prompt);
  } catch {
    return emit({});
  }

  if (!decision || decision.target === 'claude') {
    return emit({});
  }

  const headlessSuspected = isLikelyHeadless(prompt);
  const message = buildMessage(decision, headlessSuspected);
  if (!message) return emit({});

  emit({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: message,
    },
  });
}

main().catch(() => emit({}));
