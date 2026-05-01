#!/usr/bin/env node
// CCP — router-suggest hook (B19, Phase 6-A v0.2)
// Event: UserPromptSubmit
// Behavior: 사용자 프롬프트를 4축 라우터로 분류하여 위임 추천을 system reminder 로 주입.
//   결정이 'claude' 이면 noop (메인 처리). 'gemini'·'codex' 이면 추천 메시지만 주입.
// Never auto-delegates: 자동 위임은 수행하지 않으며, 사용자가 보고 직접 슬래시 호출.
//   (원칙 4 — _workspace/02_arch_decisions.md "자동 fallback 금지")
// Failure-silent: 훅이 입력을 차단하지 않는다 — 파싱 실패·예외 시 빈 출력으로 종료.

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

function buildMessage(decision) {
  const slash = SLASH_HINT[decision.target];
  if (!slash) return null;

  const tokenInfo = decision.tokens != null ? ` (~${decision.tokens.toLocaleString()} tok)` : '';
  const matched = Array.isArray(decision.matched) && decision.matched.length > 0
    ? ` [matched: ${decision.matched.slice(0, 3).join(', ')}]`
    : '';
  const reason = decision.reason || 'unknown';

  return clamp(
    `[CCP-ROUTER-001] 라우터 추천: ${decision.target} (axis ${decision.axis}, ${reason})${tokenInfo}${matched}. ` +
      `필요 시 \`${slash} "<task>"\` 로 위임하세요. 자동 위임은 수행하지 않습니다.`
  );
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

  const message = buildMessage(decision);
  if (!message) return emit({});

  emit({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: message,
    },
  });
}

main().catch(() => emit({}));
