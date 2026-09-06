#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exportRecordingArtifacts, renderSummary } from '../../../packages/exporter/src/index.js';
import { deserializeRecording } from '../../../packages/core/src/serialization.js';

async function main(): Promise<void> {
  const [, , command, input, ...args] = process.argv;
  if (!command || !input) {
    printHelp();
    process.exitCode = 1;
    return;
  }
  const recording = deserializeRecording(await readFile(resolve(input), 'utf8'));
  const out = readFlag(args, '--out');
  const mode = (readFlag(args, '--mode') as 'concise' | 'developer' | null) ?? 'concise';

  if (command === 'inspect') {
    console.log(renderSummary(recording, recording.transactions ?? [], mode));
    return;
  }
  if (command === 'export') {
    if (!out) throw new Error('Missing --out directory');
    await exportRecordingArtifacts(recording, resolve(out), { mode });
    return;
  }
  printHelp();
}

function readFlag(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || null : null;
}

function printHelp(): void {
  console.log('domrec inspect recording.json');
  console.log('domrec export recording.json --out ./recording --mode developer');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
