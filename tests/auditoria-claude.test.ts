// Auditoria completa (Claude): cada teste trava uma correção desta revisão.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { WebSocket } from 'ws';
import { broadcastRealtimeEvent, chatMessageNotice, initRealtimeWebSocketServer } from '../src/services/realtime.service.ts';
import { AuthRequest, requireAdmin, requireAdminPermission } from '../src/middleware/auth.ts';

const read = (p: string) => fs.readFileSync(p, 'utf8');

/** Chamadas de rota (`xRouter.get('/caminho', ...middlewares, handler)`) com o trecho de cada uma. */
function routeCalls(source: string) {
  const calls: Array<{ path: string; head: string }> = [];
  const re = /(?:apiRouter|expansionRouter)\.(?:get|post|put|patch|delete)\(\s*(?:\[\s*)?'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const end = source.indexOf('async (', m.index);
    calls.push({ path: m[1], head: source.slice(m.index, end === -1 ? m.index + 400 : end) });
  }
  return calls;
}

test('A1: mensagem de chat nunca vai pelo WebSocket público (só o id da conversa)', async () => {
  const server = http.createServer();
  const wss = initRealtimeWebSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const received: Array<Record<string, unknown>> = [];
  try {
    await new Promise<void>((resolve, reject) => {
      client.on('message', (raw) => {
        const event = JSON.parse(String(raw));
        if (event.type === 'connection:ready') {
          broadcastRealtimeEvent(chatMessageNotice({ id: 7, conversationCode: 'CHAT-ABC' }));
          return;
        }
        received.push(event);
        resolve();
      });
      client.on('error', reject);
    });
    assert.equal(received[0].type, 'chat:message');
    assert.deepEqual(received[0].data, { conversationId: 7 });
    assert.equal(JSON.stringify(received[0]).includes('text'), false);
  } finally {
    client.terminate();
    wss?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // E nenhuma rota manda o texto da mensagem no aviso.
  const routes = read('src/routes/expansion.routes.ts');
  const chatBroadcasts = routes.match(/broadcastRealtimeEvent\((?:[^()]|\([^()]*\))*\)/g) || [];
  for (const call of chatBroadcasts.filter((c) => c.includes('chat'))) {
    assert.match(call, /^broadcastRealtimeEvent\(chatMessageNotice\(/, call);
  }
});

test('A2: toda rota /admin/ exige a permissão de sub-admin da aba correspondente', () => {
  const calls = [...routeCalls(read('src/routes/api.ts')), ...routeCalls(read('src/routes/expansion.routes.ts'))]
    .filter((c) => c.path.startsWith('/admin/') && c.path !== '/admin/permissions'); // permissões: só o Admin Master (checado na rota)
  assert.ok(calls.length >= 20, `rotas /admin/ encontradas: ${calls.length}`);
  const missing = calls.filter((c) => !/requireAdminPermission\('[a-z]+'\)/.test(c.head)).map((c) => c.path);
  assert.deepEqual(missing, []);
  const expected: Record<string, string> = {
    '/admin/merchants/:id/verify': 'merchants',
    '/admin/coupons': 'merchants',
    '/admin/plans/:id': 'finance',
    '/admin/concierge/:id': 'overview',
    '/admin/reports/:id': 'overview',
    '/admin/integrations': 'integrations',
  };
  for (const [path, perm] of Object.entries(expected)) {
    const call = calls.find((c) => c.path === path);
    assert.ok(call, path);
    assert.match(call.head, new RegExp(`requireAdminPermission\\('${perm}'\\)`), path);
  }
  assert.equal((requireAdminPermission('finance') as unknown as { adminPermission: string }).adminPermission, 'finance');
});

test('A3: pagamento só é confirmado em reserva/assinatura aguardando pagamento', () => {
  const api = read('src/routes/api.ts');
  const verify = api.slice(api.indexOf("'/payments/verify-server'"), api.indexOf("'/bookings/:id/cancel'"));
  assert.match(verify, /booking\.status !== 'pending_payment'[\s\S]*status\(409\)/);
  assert.ok(verify.indexOf("booking.status !== 'pending_payment'") < verify.indexOf('.update(bookings)'));

  const exp = read('src/routes/expansion.routes.ts');
  const plan = exp.slice(exp.indexOf("'/merchant/plans/verify-server'"), exp.indexOf("'/merchant/campaigns'"));
  assert.match(plan, /sub\.status !== 'pending_payment'[\s\S]*status\(409\)/);
  assert.ok(plan.indexOf("sub.status !== 'pending_payment'") < plan.indexOf('recordImmutableLedgerEntry'));
});

async function callRequireAdmin(dbUser: Record<string, unknown>, authUser: Record<string, unknown> | undefined) {
  let status = 200;
  let passed = false;
  const req = { dbUser, authUser } as unknown as AuthRequest;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as never;
  await requireAdmin(req, res, () => { passed = true; });
  return passed ? 200 : status;
}

test('A4: papel de admin/sub-admin só vale com e-mail verificado (igual às regras do Firestore)', async () => {
  const admin = { role: 'admin', email: 'brasilportalvip@gmail.com' };
  assert.equal(await callRequireAdmin(admin, { email_verified: true }), 200);
  assert.equal(await callRequireAdmin(admin, { email_verified: false }), 403);
  assert.equal(await callRequireAdmin(admin, {}), 403);
  assert.equal(await callRequireAdmin({ role: 'subadmin', email: 'x@y.com' }, { email_verified: false }), 403);
  assert.equal(await callRequireAdmin({ role: 'tourist', email: 'x@y.com' }, { email_verified: true }), 403);

  const auth = read('src/middleware/auth.ts');
  assert.match(auth, /const emailVerified = decoded\.email_verified === true;/);
  assert.match(auth, /isBootstrapAdmin = [^;]*&& emailVerified;/);
  assert.match(auth, /const isSubAdmin = emailVerified && /);
});

test('A5: modais têm semântica de diálogo para leitores de tela', () => {
  for (const file of ['FrocRotaAIModal', 'DestinationDetailModal', 'ListingDetailModal', 'LegalComplianceModal', 'PWAInstallButton']) {
    const source = read(`src/components/${file}.tsx`);
    assert.match(source, /<div role="dialog" aria-modal="true" aria-label=/, file);
  }
});
