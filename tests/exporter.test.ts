import { mkdtemp, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { captureRecordingSnapshot } from '../packages/core/src/index.js';
import { clearRecordingArtifacts, exportRecordingArtifacts } from '../packages/exporter/src/index.js';
import type { Recording } from '../packages/core/src/model.js';

function createRecording(): Recording {
  const document = new JSDOM('<!doctype html><html><body><button>Save</button></body></html>').window.document;
  const snapshot = captureRecordingSnapshot(document, {});
  return {
    id: 'rec-1',
    version: '1.0.0',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    url: 'https://example.com',
    title: 'Example',
    userAgent: 'test',
    initialSnapshot: snapshot,
    finalSnapshot: snapshot,
    events: [],
  };
}

describe('exporter', () => {
  it('clears old files before writing new artifacts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dom-recorder-'));
    await writeFile(join(dir, 'old.txt'), 'old');
    await writeFile(join(dir, 'recording.json'), 'stale');

    await clearRecordingArtifacts(dir);

    await expect(access(join(dir, 'recording.json'))).rejects.toThrow();
    await expect(access(join(dir, 'old.txt'))).resolves.toBeUndefined();
  });

  it('writes fresh export artifacts by default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dom-recorder-'));
    await writeFile(join(dir, 'stale.txt'), 'stale');

    await exportRecordingArtifacts(createRecording(), dir);

    const files = await readdir(dir);
    expect(files).toEqual(expect.arrayContaining(['recording.json', 'evidence.json', 'summary.md', 'initial.html', 'final.html']));
    expect(files).toContain('stale.txt');
    const summary = await readFile(join(dir, 'summary.md'), 'utf8');
    expect(summary).toContain('DOM Recording');
  });
});
