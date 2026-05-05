#!/usr/bin/env node
// CCP — router-suggest hook (recommendation hook · split responsibility)
// Event: UserPromptSubmit
//
// Responsibility split between hook and router agent:
//   - auto_routing OFF (default) → hook injects recommendation
//   - auto_routing ON + canonical → hook is NOOP (router agent handles dispatch via
//     description-based auto-invocation — see README §5.3)
//   - auto_routing ON + headless detected → hook still injects recommendation
//     (router agent does NOT auto-delegate; multi-signal OR detection)
//   - decision === 'claude' → noop in both modes
//
// Failure-silent: on parse failure or exception, exit with empty output.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUMMARY_MAX_CHARS = 500;
const SLASH_HINT = {
  gemini: '/gemini:rescue',
  codex: '/ccp:codex-rescue',
};

// Warn against meta-bypass when headless automation is suspected.
// Intended to block meta-exploration cycles (Skill→Agent→companion→direct CLI)
// observed in headless benchmark runs that erased delegation savings.
// If there is no sign of a direct user slash call and automation keywords appear,
// append one recommended pattern line.
const HEADLESS_HINT = /headless|claude\s*-p|\uC2A4\uD06C\uB9BD\uD2B8|\uC790\uB3D9\uD654|automation|cron|CI/i;
const SLASH_PRESENT = /\/(?:ccp:codex-|gemini:|ccp:gemini-)/;

function isLikelyHeadless(promptText) {
  if (SLASH_PRESENT.test(promptText)) return false;
  return HEADLESS_HINT.test(promptText);
}

// Multi-signal OR for confident headless detection.
// Mirrors router-decide.mjs#detectHeadlessConfident (single SSOT for the
// canonical/headless decision). `process.stdin.isTTY` intentionally NOT used \u2014
// it is always null inside hook child processes regardless of parent TTY.
function detectHeadlessConfident(env = process.env) {
  if (env.CI === 'true' || env.CI === '1') return true;
  if (env.CLAUDE_CODE_NONINTERACTIVE === '1' || env.CLAUDE_CODE_NONINTERACTIVE === 'true') return true;
  const ep = env.CLAUDE_CODE_ENTRYPOINT;
  if (ep && ep !== 'cli') return true;
  return false;
}

// Read plugin.json#config.auto_routing (opt-in, default false).
function readAutoRoutingConfig() {
  const root = process.env.CLAUDE_PLUGIN_ROOT
    ? resolve(process.env.CLAUDE_PLUGIN_ROOT)
    : resolve(__dirname, '..');
  const manifest = resolve(root, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifest)) return false;
  try {
    const json = JSON.parse(readFileSync(manifest, 'utf8'));
    return json?.config?.auto_routing === true;
  } catch {
    return false;
  }
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

  // Split responsibility between hook (recommendation) and router agent
  // (auto-delegation). When auto_routing is on AND the environment is
  // canonical (no confident headless signals), the hook is NOOP because the
  // router agent's description-based auto-invocation will pick up the prompt
  // and run router-decide.mjs itself.
  //
  // In all other cases (auto_routing off / headless confident) we keep the
  // recommendation behavior — single source of recommendation, no
  // double-emission.
  const autoRoutingActive = readAutoRoutingConfig() && !detectHeadlessConfident();
  if (autoRoutingActive) {
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
