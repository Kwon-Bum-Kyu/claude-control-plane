#!/usr/bin/env node
// CCP — test-only variants of the mock adapter. Only values change, so the
// frozen adapter contract still holds (assertAdapter accepts both). Each
// variant reaches a combination no shipped adapter has today and drives the
// real core/runtime.mjs through it.
import { fileURLToPath } from 'node:url';
import { run } from '../../../plugins/ccp/scripts/core/runtime.mjs';
import base from './adapter.mjs';

const VARIANTS = {
  // A foreground job record combined with a parse error.
  'persist-parse-error': {
    ...base,
    result: { ...base.result, persistForeground: true },
    errors: { ...base.errors, 'CCP-MOCK-002': { message: 'Mock response could not be parsed', action: 'Retry.', recovery: 'retry' } },
    parseResult: (input) => ({ ...base.parseResult(input), errorCode: 'CCP-MOCK-002', errorDetails: { stdout_head: String(input.stdout || '').slice(0, 200) } }),
  },
  // A version probe bounded by a short probe timeout.
  'short-probe': { ...base, timeouts: { ...base.timeouts, authProbe: 1000 } },
};

const adapter = VARIANTS[process.env.CCP_MOCK_VARIANT];
if (!adapter) {
  process.stderr.write(`variant-companion: unknown CCP_MOCK_VARIANT ${JSON.stringify(process.env.CCP_MOCK_VARIANT)}\n`);
  process.exit(64);
}
run(adapter, process.argv.slice(2), { entryScriptPath: fileURLToPath(import.meta.url), workerArgsPrefix: [] });
