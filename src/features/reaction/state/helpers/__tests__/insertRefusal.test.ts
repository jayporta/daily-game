import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insertRefusalTags } from '#src/features/reaction/state/helpers/insertRefusal.ts';

/** A real Supabase/PostgREST body for a `reactions_reasons_check` violation. */
const CHECK_VIOLATION = {
  code: '23514',
  details: null,
  hint: null,
  message: 'new row for relation "reactions" violates check constraint "reactions_reasons_check"',
};

test('insertRefusalTags extracts both the code and the constraint name', () => {
  assert.deepEqual(insertRefusalTags(CHECK_VIOLATION), {
    code: '23514',
    constraint: 'reactions_reasons_check',
  });
});

test('insertRefusalTags accepts a PostgREST code', () => {
  assert.deepEqual(insertRefusalTags({ code: 'PGRST116', message: 'no rows' }), {
    code: 'PGRST116',
  });
});

test('insertRefusalTags drops a code that does not match either shape', () => {
  assert.deepEqual(insertRefusalTags({ code: '<script>' }), {});
});

test('insertRefusalTags drops an overlong code', () => {
  assert.deepEqual(insertRefusalTags({ code: '23514'.repeat(10) }), {});
});

test('insertRefusalTags gives no constraint tag when the message names none', () => {
  assert.deepEqual(insertRefusalTags({ code: '23514', message: 'something went wrong' }), {
    code: '23514',
  });
});

test('insertRefusalTags gives {} for non-object input', () => {
  assert.deepEqual(insertRefusalTags('nope'), {});
  assert.deepEqual(insertRefusalTags(null), {});
  assert.deepEqual(insertRefusalTags([1, 2, 3]), {});
});
