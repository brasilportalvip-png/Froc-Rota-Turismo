import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rulesContent = fs.readFileSync('firestore.rules', 'utf8');

test('Firestore Rules enforce global default-deny and rules_version 2', () => {
  assert.match(rulesContent, /rules_version = '2';/);
  assert.match(rulesContent, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
});

test('Firestore Rules strictly enforce email_verified and prevent role self-escalation', () => {
  assert.match(rulesContent, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesContent, /incoming\(\)\.role in \['tourist', 'merchant'\]/);
  assert.match(rulesContent, /incoming\(\)\.role == existing\(\)\.role/);
});

test('Firestore Rules prevent cost-explosions (no get/exists inside list rules)', () => {
  const listMatches = [...rulesContent.matchAll(/allow list:([^;]+);/g)].map((m) => m[1]);
  assert.ok(listMatches.length >= 8, 'Expected explicit list rules across collections');
  for (const expr of listMatches) {
    assert.equal(
      /\b(get|exists)\s*\(/.test(expr),
      false,
      `Forbidden get()/exists() detected inside allow list rule: ${expr}`
    );
  }
});

test('Firestore Rules lock PII private subcollection, terminal chat status, and immutable owner fields', () => {
  assert.match(rulesContent, /match \/private\/\{docId\}/);
  assert.match(rulesContent, /existing\(\)\.status != 'resolved'/);
  assert.match(rulesContent, /incoming\(\)\.ownerUid == existing\(\)\.ownerUid/);
  assert.match(rulesContent, /incoming\(\)\.createdAt == request\.time/);
});
