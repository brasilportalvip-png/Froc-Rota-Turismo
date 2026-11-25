// A Vercel transforma cada api/*.ts em .js mas não reescreve os imports: um import
// "./_lib/x.ts" quebra TODAS as funções (500 em todas as rotas /api). Use ".js".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );

test('funções da Vercel (api/) importam arquivos locais com .js, nunca .ts', () => {
  const bad: string[] = [];
  for (const file of walk('api').filter((f) => f.endsWith('.ts'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/(?:from\s+|import\s*\(\s*)'(\.{1,2}\/[^']+)'/g)) {
      if (!m[1].endsWith('.js')) bad.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});

// O firebase-admin 14 traz o jwks-rsa 4, que faz require('jose') de uma versão só-ESM.
// A Vercel roda com --no-experimental-require-module: o firebase-admin não carregava
// ("require() of ES Module .../jose ... not supported") e as rotas davam 500.
test('jwks-rsa fixo na 3.x (jose 4, compatível com require) e instalação aceita a troca', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(String(pkg.overrides?.['jwks-rsa'] ?? ''), /^3\./);
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  assert.equal(vercel.installCommand, 'bun install');
});
