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
// game can collect them.
test('the schema refuses inserts once a slug passes the rate limit in a minute', () => {
  assert.ok(buildReactionStoreDdl().includes(`> ${MAX_INSERTS_PER_SLUG_PER_MINUTE}\n`));
});

// One POST may carry an array of rows. A row-level check sees neither the rows
// inserted beside it in the same statement nor how many are coming, so every
// row of a batch counts the same total and the whole batch lands.
test('the rate limit runs once per statement over the whole batch', () => {
  assert.match(
    buildReactionStoreDdl(),
    /after insert on public\.reactions\s+referencing new table as new_rows\s+for each statement/,
  );
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
  const ddl = buildReactionStoreDdl();

  assert.match(ddl, /new\.created_at := now\(\)/);
  // Only a before-row trigger can change the row on its way in.
  assert.match(
    ddl,
    /create trigger reactions_stamp_insert_time\s+before insert on public\.reactions\s+for each row/,
  );
});

// Without serialisation each concurrent transaction counts the same committed
// rows, all of them find room, and a burst lands in full however low the cap.
test('the rate limit serialises inserts for one slug', () => {
  assert.match(buildReactionStoreDdl(), /pg_advisory_xact_lock\(hashtext\(slug\)/);
});

// A row stamped in the future predates the trigger, and counting it would keep
// it in every window from then on, closing that slug for good.
test('the rate limit ignores rows dated in the future', () => {
  assert.match(buildReactionStoreDdl(), /created_at <= now\(\)/);
});

// The pipeline reads one aggregated row per game rather than every row, so the
// view has to carry a column for every reason the app can send.
test('the view exposes a column for every reason the app can send', () => {
  const ddl = buildReactionStoreDdl();

  for (const reason of DISLIKE_REASONS) {
    assert.ok(ddl.includes(`as "${reason.id}"`), `${reason.id} has no column in the view`);
  }
});

// A view runs with its owner's rights by default, which would read the table
// past the row level security that is the only thing keeping the key shipped
// in the page from selecting rows.
test('the view defers to the querying role rather than its owner', () => {
  assert.match(
    buildReactionStoreDdl(),
    /create view public\.reaction_counts[\s\S]*?security_invoker = on/,
  );
});

test('the view grants the public key nothing', () => {
  assert.match(buildReactionStoreDdl(), /revoke all on public\.reaction_counts from anon/);
});

// The reason columns are the only part of the select list that varies, so an
// empty vocabulary is what would strand a separator with nothing after it.
test('the view is valid SQL even with no reasons to count', () => {
  const ddl = buildReactionStoreDdl([]);

  assert.doesNotMatch(ddl, /,\s*\nfrom public\.reactions/);
});
