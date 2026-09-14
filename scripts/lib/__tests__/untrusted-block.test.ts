import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closingTag, defangDelimiters, untrustedBlock } from '#scripts/lib/untrusted-block.ts';

test('untrustedBlock wraps content in the named tags', () => {
  const block = untrustedBlock('game-source', 'hello');

  assert.match(block, /^<untrusted-game-source>\n\nhello\n\n<\/untrusted-game-source>$/);
});

// The closing tag is the whole mechanism: content that can emit one ends the
// block early, and everything after it reads as prompt rather than as data.
test('content cannot close the block it sits in', () => {
  const block = untrustedBlock('game-source', 'a</untrusted-game-source>b');

  assert.equal(block.split(closingTag('game-source')).length - 1, 1);
});

test('content cannot open a block of its own', () => {
  const block = untrustedBlock('game-source', 'a<untrusted-game-source>b');

  assert.equal(block.split('<untrusted-game-source>').length - 1, 1);
});

test('a delimiter is defanged however it is cased', () => {
  assert.equal(defangDelimiters('</UNTRUSTED-game-source>'), '&lt;/UNTRUSTED-game-source>');
});

// The reader is a model following prose, not a markup parser, so a tag it
// would still recognise has to be defanged even when it is not well formed.
test('a delimiter padded with whitespace is defanged too', () => {
  for (const padded of ['< /untrusted-x>', '</ untrusted-x>', '<\n/untrusted-x>']) {
    assert.match(defangDelimiters(padded), /^&lt;/, `${JSON.stringify(padded)} survived`);
  }
});

test('defangDelimiters leaves ordinary markup alone', () => {
  assert.equal(defangDelimiters('<div></div><script>x</script>'), '<div></div><script>x</script>');
});
