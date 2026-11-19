import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';

test('saved result loader handles missing records and server errors', async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.window = {
    localStorage: globalThis.localStorage,
    fetch: async url => {
      const type = new URL(url).searchParams.get('analysis_type');
      if (type === 'missing') return new Response('null', { status: 200 });
      if (type === 'bad') return new Response(JSON.stringify({ error: 'Project unavailable' }), { status: 500 });
      return new Response(JSON.stringify({ results: { kind: type } }), { status: 200 });
    },
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  try {
    const { api } = await server.ssrLoadModule('/src/utils/api.ts');
    assert.deepEqual(await api.loadProjectResults('/study', 'pls', 'model', 'missing'), {});
    assert.equal((await api.loadProjectResults('/study', 'pls', 'model', 'bad')).error, 'Project unavailable');
    for (const type of ['pls', '_saved_consistent_pls', '_saved_mga', '_saved_permutation']) {
      assert.equal((await api.loadProjectResults('/study', 'pls', 'model', type)).results.kind, type);
    }
  } finally {
    await server.close();
  }
});
