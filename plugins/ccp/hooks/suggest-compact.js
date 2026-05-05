#!/usr/bin/env node
// CCP — suggest-compact hook
// Events: UserPromptSubmit, PreCompact
// Behavior: recommend voluntary compaction to the user when context reaches the 75% threshold (info).
// Never auto-runs /compact (no automatic fallback — see README §4).

import { readFileSync, statSync, existsSync } from 'node:fs';

const TOKEN_BUDGET = 200000; // Assume the standard limit for the main Claude Code session
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
  // Simple heuristic: words × 1.3.
  // transcript.jsonl is JSON per line. Approximate from the whole size
  // instead of extracting and summing only message bodies.
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
      // Parse failures stay silent — a broken hook must not block user input.
      return emit({});
    }
  }

  const event = payload.hook_event_name || 'UserPromptSubmit';
  const transcriptPath = payload.transcript_path;

  // PreCompact branch — notice right before compaction
  if (event === 'PreCompact') {
    return emit({
      hookSpecificOutput: {
        hookEventName: 'PreCompact',
        additionalContext: clamp(
          '[CCP-COMPACT-001] _workspace/_jobs/ and _workspace/_audits/ are preserved by .gitignore. You can still recover them with /gemini:status <id> after compaction.'
        ),
      },
    });
  }

  // UserPromptSubmit branch
  const transcript = safeReadFile(transcriptPath);
  const estTokens = estimateTokensFromTranscript(transcript);
  const ratio = estTokens / TOKEN_BUDGET;

  if (ratio < WARN_RATIO) {
    // noop — below threshold
    return emit({});
  }

  const message = clamp(
    `[CCP-COMPACT-001] Context usage has reached ${Math.round(
      ratio * 100
    )}% (≥ 75%). Run \`/compact\` manually, or delegate large work with \`/gemini:rescue\`.`
  );

  return emit({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: message,
    },
  });
}

main();
