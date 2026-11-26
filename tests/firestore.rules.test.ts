import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rulesContent = fs.readFileSync('firestore.rules', 'utf8');

test('Firestore Rules: banco fechado para acesso direto do navegador (tudo passa pelo servidor)', () => {
  assert.match(rulesContent, /rules_version = '2';/);
  assert.match(rulesContent, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  // Nenhuma regra "allow ... if" que libere algo
  const libera = [...rulesContent.matchAll(/allow [a-z, ]+:\s*if ([^;]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(libera, ['false']);
});

test('Navegador não usa o Firestore direto (sem onSnapshot/getDoc/setDoc no src)', () => {
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  for (const f of walk('src').filter((x) => /\.(ts|tsx)$/.test(x))) {
    const s = fs.readFileSync(f, 'utf8');
    assert.equal(/from 'firebase\/firestore'/.test(s), false, `${f} importa firebase/firestore`);
  }
});
