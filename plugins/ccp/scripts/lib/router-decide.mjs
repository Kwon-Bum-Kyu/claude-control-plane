#!/usr/bin/env node
// CCP — router-decide.mjs (deterministic-router CLI entry)
//
// Single Bash entry point invoked by:
//   1. agents/router.md (router agent — forwarding wrapper, dispatch defense)
//   2. hooks/router-suggest.js (when delegating to agent path)
//   3. CLI test harness (router-eval, router-suggest-test)
//
// Behavior — strictly deterministic:
//   - Reads --prompt (or stdin JSON `prompt`/`user_prompt`/`input`)
//   - Calls router.mjs#classify (same SSOT shared with the recommendation hook
//     and the router regression suite)
//   - Detects canonical/headless via multi-signal OR:
//       env.CI / env.CLAUDE_CODE_NONINTERACTIVE / env.CLAUDE_CODE_ENTRYPOINT (≠cli)
//     `process.stdin.isTTY` is NOT used (always null inside hook child processes).
//   - Reads plugin.json#config.auto_routing (opt-in, default false)
//   - Emits success envelope with details.mode === "router" + reason_code enum
//
// Runtime defense — JSON only, no free text. The reason_code enum is the
// only free-form field allowed in details and is bounded to 12 values.
// Stderr is reserved for diagnostic notes (e.g. headless reason text).
//
// Usage:
//   node router-decide.mjs --prompt "<text>"
//   node router-decide.mjs --prompt "<text>" --auto-routing on
//   node router-decide.mjs --prompt "<text>" --no-auto-route
//   echo '{"prompt":"..."}' | node router-decide.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { classify } from './router.mjs';
import { assertEnvelope } from './envelope-validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUMMARY_MAX = 500;

// --- argv parsing ----------------------------------------------------------

function parseArgv(argv) {
  const out = { prompt: null, autoRoutingOverride: null, noAutoRoute: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompt' && i + 1 < argv.length) {
      out.prompt = argv[++i];
    } else if (a === '--auto-routing' && i + 1 < argv.length) {
      const v = argv[++i].toLowerCase();
      if (v === 'on' || v === 'true' || v === '1') out.autoRoutingOverride = true;
      else if (v === 'off' || v === 'false' || v === '0') out.autoRoutingOverride = false;
    } else if (a === '--no-auto-route') {
      out.noAutoRoute = true;
    }
  }
  return out;
}

function readStdinSync() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function resolvePromptFromStdin(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed);
    return obj.prompt ?? obj.user_prompt ?? obj.input ?? null;
  } catch {
    return null;
  }
}

// --- canonical/headless detection (multi-signal OR) ------------------------

function detectHeadlessConfident(env = process.env) {
  if (env.CI === 'true' || env.CI === '1') {
    return { confident: true, reason: 'env.CI' };
  }
  if (env.CLAUDE_CODE_NONINTERACTIVE === '1' || env.CLAUDE_CODE_NONINTERACTIVE === 'true') {
    return { confident: true, reason: 'env.CLAUDE_CODE_NONINTERACTIVE' };
  }
  // CLAUDE_CODE_ENTRYPOINT default 'cli' = canonical. Anything else (e.g.
  // future 'headless' or 'sdk') is treated as headless. Empty or missing is
  // tolerated as canonical (matches current Claude Code behavior).
  const ep = env.CLAUDE_CODE_ENTRYPOINT;
  if (ep && ep !== 'cli') {
    return { confident: true, reason: `env.CLAUDE_CODE_ENTRYPOINT=${ep}` };
  }
  return { confident: false };
}

// --- plugin.json#config.auto_routing read ----------------------------------

function readAutoRoutingConfig() {
  const root = process.env.CLAUDE_PLUGIN_ROOT
    ? resolve(process.env.CLAUDE_PLUGIN_ROOT)
    : resolve(__dirname, '..', '..');
  const manifest = resolve(root, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifest)) return false;
  try {
    const json = JSON.parse(readFileSync(manifest, 'utf8'));
    return json?.config?.auto_routing === true;
  } catch {
    return false;
  }
}

// --- reason mapping (router.mjs#classify reason -> envelope reason_code) ---

const REASON_CODE_MAP = {
  user_explicit_codex: 'AXIS_A_SLASH',
  user_explicit_gemini: 'AXIS_A_SLASH',
  user_explicit_claude: 'AXIS_A_FALLBACK_CLAUDE',
  user_explicit_codex_option: 'AXIS_A_OPTION',
  // Magic keywords share AXIS_A_SLASH (axis A user-explicit, same priority).
  user_explicit_gemini_magic: 'AXIS_A_SLASH',
  user_explicit_codex_magic: 'AXIS_A_SLASH',
  user_explicit_claude_magic: 'AXIS_A_SLASH',
  too_large: 'AXIS_B_OVERSIZED',
  mid_review_codex: 'AXIS_B_MID_REVIEW',
  mid_review_codex_oversized: 'AXIS_B_MID_REVIEW',
  too_small: 'AXIS_B_TOO_SMALL',
  keyword_gemini: 'AXIS_C_KW_GEMINI',
  keyword_gemini_priority: 'AXIS_C_KW_GEMINI',
  keyword_codex: 'AXIS_C_KW_CODEX',
  keyword_codex_priority: 'AXIS_C_KW_CODEX',
  keyword_claude: 'AXIS_C_KW_CLAUDE',
  keyword_claude_priority: 'AXIS_C_KW_CLAUDE',
  main_context_bind: 'AXIS_C_MAIN_CONTEXT_BIND',
  default_conservative: 'AXIS_D_DEFAULT_CONSERVATIVE',
};

function mapReasonCode(decision) {
  return REASON_CODE_MAP[decision.reason] ?? 'AXIS_D_DEFAULT_CONSERVATIVE';
}

const SLASH_HINT = {
  gemini: '/gemini:rescue',
  codex: '/ccp:codex-rescue',
  claude: null,
};

// --- main ------------------------------------------------------------------

function buildSummary({ decision, headless, autoRouted, autoRoutingActive }) {
  const slash = SLASH_HINT[decision.target];
  const headlessFlag = headless.confident ? ` headless=${headless.reason}` : '';
  const autoFlag = autoRouted ? ' auto_routed=true' : '';
  const optFlag = autoRoutingActive ? '' : ' auto_routing=off';
  const slashFrag = slash ? ` ${slash}` : '';
  const summary =
    `[CCP-ROUTER-002] decision=${decision.target} axis=${decision.axis} ` +
    `reason=${decision.reason}${slashFrag}${headlessFlag}${autoFlag}${optFlag}`;
  return summary.length <= SUMMARY_MAX ? summary : summary.slice(0, SUMMARY_MAX - 16) + '...(truncated)';
}

function emit(env) {
  const checked = assertEnvelope(env);
  process.stdout.write(JSON.stringify(checked));
  process.exit(env.exit_code ?? 0);
}

function main() {
  const flags = parseArgv(process.argv.slice(2));
  const stdinPrompt = resolvePromptFromStdin(readStdinSync());
  const prompt = flags.prompt ?? stdinPrompt;

  if (typeof prompt !== 'string' || prompt.length === 0) {
    return emit({
      error: {
        code: 'CCP-INVALID-001',
        message: 'router-decide requires --prompt or stdin {prompt}',
        action: 'Pass --prompt "<text>" or pipe JSON {"prompt":"..."} on stdin.',
        recovery: 'user_action_required',
      },
      exit_code: 2,
      details: { mode: 'router' },
    });
  }

  let decision;
  try {
    decision = classify(prompt);
  } catch (err) {
    return emit({
      error: {
        code: 'CCP-ROUTER-001',
        message: `router.classify failed: ${err?.message ?? 'unknown'}`,
        action: 'Inspect router.mjs and rerun. Default to manual slash invocation.',
        recovery: 'abort',
      },
      exit_code: 3,
      details: { mode: 'router' },
    });
  }

  const headless = detectHeadlessConfident();
  const optInActive = flags.autoRoutingOverride ?? readAutoRoutingConfig();
  const optedOut = flags.noAutoRoute === true;
  const autoRoutingActive = optInActive && !headless.confident && !optedOut;
  const autoRouted = autoRoutingActive && decision.target !== 'claude';

  if (optedOut) {
    process.stderr.write(`[router-decide] opt-out via --no-auto-route\n`);
  }
  if (headless.confident) {
    process.stderr.write(`[router-decide] headless detected: ${headless.reason}\n`);
  }

  const reasonCode = optedOut
    ? 'OPT_OUT_NO_AUTO_ROUTE'
    : mapReasonCode(decision);

  const env = {
    summary: buildSummary({ decision, headless, autoRouted, autoRoutingActive }),
    result_path: null,
    tokens: { input: 0, output: 0 },
    exit_code: 0,
    auto_routed: autoRouted,
    details: {
      mode: 'router',
      decision: decision.target,
      target: SLASH_HINT[decision.target],
      axis: decision.axis,
      reason_code: reasonCode,
      headless_confident: headless.confident,
    },
  };
  emit(env);
}

main();

export { detectHeadlessConfident, mapReasonCode, REASON_CODE_MAP, SLASH_HINT };
