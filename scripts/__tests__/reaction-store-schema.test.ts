import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISLIKE_REASONS, REACTION_KINDS, SLUG_PATTERN } from '#lib/reaction-types.ts';
import {
  buildReactionStoreDdl,
  MAX_INSERTS_PER_SLUG_PER_MINUTE,
} from '#scripts/reaction-store-schema.ts';

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

// The insert policy admits any row, so nothing above this bounds how fast one
// game can collect them. Only a before-insert trigger can refuse the row.
test('the schema refuses inserts once a slug hits the rate limit in a minute', () => {
  const ddl = buildReactionStoreDdl();

  assert.match(ddl, /create trigger \w+\s+before insert on public\.reactions/);
  assert.ok(ddl.includes(`>= ${MAX_INSERTS_PER_SLUG_PER_MINUTE} then`));
});

// The limit counts existing rows for the slug, and the inserting key has no
// select policy. Under invoker rights that count is zero however many rows
// exist, so the trigger would install cleanly and never once fire.
test('the rate limit reads rows the inserting key cannot select', () => {
  assert.match(
    buildReactionStoreDdl(),
    /create or replace function public\.reactions_rate_limit[\s\S]*?security definer/,
  );
});

// The insert policy admits any column, not only the ones the page sends, so a
// caller can supply its own created_at. Rows dated last year would sit outside
// every window the limit counts, and the cap would never fire.
test('the rate limit stamps the insert time rather than trusting the row', () => {
  assert.match(buildReactionStoreDdl(), /new\.created_at := now\(\)/);
});

// Without serialisation each concurrent transaction counts the same committed
// rows, all of them find room, and a burst lands in full however low the cap.
test('the rate limit serialises inserts for one slug', () => {
  assert.match(buildReactionStoreDdl(), /pg_advisory_xact_lock\(hashtext\(new\.slug\)/);
});

// A row stamped in the future predates the trigger, and counting it would keep
// it in every window from then on, closing that slug for good.
test('the rate limit ignores rows dated in the future', () => {
  assert.match(buildReactionStoreDdl(), /created_at <= now\(\)/);
});
