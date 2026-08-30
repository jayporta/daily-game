import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReactionStoreDdl } from './reaction-store-schema.ts';
import { DISLIKE_REASONS, REACTION_KINDS, SLUG_PATTERN } from '../lib/reaction-types.ts';

test('the schema allows every reason the app can send', () => {
  const ddl = buildReactionStoreDdl();

  for (const reason of DISLIKE_REASONS) {
    assert.ok(ddl.includes(`'${reason.id}'`), `${reason.id} is not allowed by the schema`);
  }
});

test('the schema allows every reaction kind the app can send', () => {
  const ddl = buildReactionStoreDdl();

  for (const kind of REACTION_KINDS) {
    assert.ok(ddl.includes(`'${kind}'`), `${kind} is not allowed by the schema`);
  }
});

test('the schema constrains slugs with the same pattern the app validates against', () => {
  assert.ok(buildReactionStoreDdl().includes(SLUG_PATTERN.source));
});

// The point of generating this: the vocabulary lives in one place, so a
// rename cannot leave the database rejecting rows the app still sends.
test('renaming a reason changes the schema with it', () => {
  const ddl = buildReactionStoreDdl();
  const renamed = buildReactionStoreDdl([{ id: 'renamed-reason', label: 'Renamed' }]);

  assert.ok(renamed.includes("'renamed-reason'"));
  assert.notEqual(renamed, ddl);
  for (const reason of DISLIKE_REASONS) {
    assert.ok(!renamed.includes(`'${reason.id}'`), `${reason.id} survived the rename`);
  }
});

test('the schema turns on row level security', () => {
  assert.match(buildReactionStoreDdl(), /enable row level security/i);
});

// The key that ships in the page must be able to insert and nothing else.
test('the schema grants the public key insert and no other verb', () => {
  const ddl = buildReactionStoreDdl();
  const policyVerbs = [...ddl.matchAll(/for (\w+) to anon/g)].map((match) => match[1]);

  assert.deepEqual(policyVerbs, ['insert']);
});
