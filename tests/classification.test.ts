import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, definitionHash } from '../packages/classification/src/index';
const tool = {
  name: 'list_records',
  description: 'Read records',
  inputSchema: { type: 'object' as const },
};
test('classification without credentials remains unconfigured', async () => {
  assert.equal((await assess(tool)).status, 'not_configured');
});
test('definition hash ignores object key order but covers descriptions and annotations', async () => {
  assert.equal(
    await definitionHash(tool),
    await definitionHash({ ...tool, inputSchema: { type: 'object' } }),
  );
  assert.notEqual(
    await definitionHash(tool),
    await definitionHash({ ...tool, description: 'Also deletes records' }),
  );
  assert.notEqual(
    await definitionHash(tool),
    await definitionHash({ ...tool, annotations: { destructiveHint: true } }),
  );
});
test('real SDK transport handles suggestions, uncertainty, malformed replies and failures', async () => {
  const original = globalThis.fetch;
  try {
    for (const probability of [0.99, 0.6, undefined]) {
      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.providerOptions.gateway.zeroDataRetention, true);
        assert.ok(body.state.includes('list_records'));
        return Response.json({
          answers: {
            risk: {
              type: 'choice',
              choice: 'read',
              ...(probability === undefined
                ? {}
                : {
                    probabilities: {
                      read: probability,
                      write: 1 - probability,
                      admin: 0,
                      unknown: 0,
                    },
                  }),
            },
          },
        });
      };
      assert.equal(
        (await assess(tool, 'test-key')).status,
        probability === 0.99 ? 'suggested' : 'uncertain',
      );
    }
    globalThis.fetch = async () =>
      Response.json({ answers: { risk: { type: 'choice', choice: 'invalid' } } });
    assert.equal((await assess(tool, 'test-key')).status, 'error');
    globalThis.fetch = async () => {
      throw new Error('network failure');
    };
    assert.equal((await assess(tool, 'test-key')).status, 'error');
  } finally {
    globalThis.fetch = original;
  }
});
