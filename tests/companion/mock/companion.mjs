#!/usr/bin/env node
// CCP — thin test-only alias for the mock adapter, mirroring the shape of
// the two shipped entry aliases (codex-companion.mjs / antigravity-companion.mjs).
// Not part of the plugin surface — exists only so contract-test.mjs can
// drive the mock adapter through core/runtime.mjs's real dispatch path via a
// subprocess, the same way golden capture does for the shipped adapters.
import { fileURLToPath } from 'node:url';
import { run } from '../../../plugins/ccp/scripts/core/runtime.mjs';
import adapter from './adapter.mjs';

run(adapter, process.argv.slice(2), { entryScriptPath: fileURLToPath(import.meta.url), workerArgsPrefix: [] });
