#!/usr/bin/env node
// CCP — suggest-compact hook
// Events: UserPromptSubmit, PreCompact
// Behavior: 컨텍스트 75% 임계 도달 시 사용자에게 자발적 압축 권고 (info).
// Never auto-runs /compact (원칙 4 — _workspace/02_arch_decisions.md).
//
// Originally derived from: github.com/affaan-m/everything-claude-code (hooks/suggest-compact.js)
// Original license: MIT — see /ATTRIBUTION.md §1.1
// Modifications: dual-event registration (UserPromptSubmit + PreCompact),
//                Korean message, removal of auto-/compact trigger.

import { readFileSync, statSync, existsSync } from 'node:fs';

const TOKEN_BUDGET = 200000; // Claude Code 메인 세션 표준 한도 가정
const WARN_RATIO = 0.75;
const SUMMARY_MAX_CHARS = 500;

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

function safeReadFile(path, maxBytes = 5_000_000) {
  if (!path || !existsSync(path)) return null;
  try {
    const st = statSync(path);
    if (!st.isFile()) return null;
    const fd = readFileSync(path, 'utf8');
    return fd.length > maxBytes ? fd.slice(-maxBytes) : fd;
  } catch {
    return null;
  }
}

function estimateTokensFromTranscript(text) {
  if (!text) return 0;
  // 간이 휴리스틱: words×1.3.
  // transcript.jsonl 은 한 줄당 JSON. 본문만 골라 합산하지 않고 전체 size 기반 근사.
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

function clamp(text) {
  if (!text) return '';
  return text.length <= SUMMARY_MAX_CHARS
    ? text
    : text.slice(0, SUMMARY_MAX_CHARS - 16) + '...(truncated)';
}

function main() {
  const raw = readStdinSync().trim();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      // 파싱 실패는 silent — 훅 오작동으로 사용자 입력을 차단하지 않는다.
      return emit({});
    }
  }

  const event = payload.hook_event_name || 'UserPromptSubmit';
  const transcriptPath = payload.transcript_path;

  // PreCompact 분기 — 압축 직전 안내
  if (event === 'PreCompact') {
    return emit({
      hookSpecificOutput: {
        hookEventName: 'PreCompact',
        additionalContext: clamp(
          '[CCP-COMPACT-001] _workspace/_jobs/ 와 _workspace/_audits/ 는 .gitignore 로 보존됩니다. 압축 후에도 /gemini:status <id> 로 회수 가능.'
        ),
      },
    });
  }

  // UserPromptSubmit 분기
  const transcript = safeReadFile(transcriptPath);
  const estTokens = estimateTokensFromTranscript(transcript);
  const ratio = estTokens / TOKEN_BUDGET;

  if (ratio < WARN_RATIO) {
    // noop — 임계 미만
    return emit({});
  }

  const message = clamp(
    `[CCP-COMPACT-001] 컨텍스트 사용량이 ${Math.round(
      ratio * 100
    )}% (≥ 75%) 에 도달했습니다. \`/compact\` 로 수동 압축하거나, 대형 작업은 \`/gemini:rescue\` 로 위임하세요.`
  );

  return emit({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: message,
    },
  });
}

main();
