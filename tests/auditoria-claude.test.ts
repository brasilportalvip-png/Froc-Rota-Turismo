// Auditoria de segurança e arquitetura serverless/Firebase: trava cada invariante crítica.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isExactApprovedPendingPayment } from '../api/webhooks/mercadopago.ts';
import { hasAdminPermission, isVerifiedAdminIdentity } from '../api/_lib/auth.ts';

const read = (p: string) => fs.readFileSync(p, 'utf8');

test('A1: chat em tempo real usa Firestore onSnapshot isolado por ownerUid/staff sem broadcast público', () => {
  const drawer = read('src/components/RealtimeChatDrawer.tsx');
  assert.match(drawer, /onSnapshot\(/);
  assert.match(drawer, /where\('ownerUid', '==', firebaseUser\.uid\)/);
  assert.match(drawer, /where\('conversationOwnerUid', '==', firebaseUser\.uid\)/);
  assert.equal(drawer.includes('ws://'), false);
  assert.equal(drawer.includes('wss://'), false);
});

test('A2: toda rota /admin/ em api/admin.ts exige requireAdminContext com permissão ou Master Admin', () => {
  const adminSrc = read('api/admin.ts');
  assert.match(adminSrc, /requireAdminContext\(req, res, 'overview'\)/);
  assert.match(adminSrc, /requireAdminContext\(req, res, 'merchants'\)/);
  assert.match(adminSrc, /requireAdminContext\(req, res, 'finance'\)/);
  assert.match(adminSrc, /requireAdminContext\(req, res, 'integrations'\)/);
  assert.match(adminSrc, /requireAdminContext\(req, res, 'editorial'\)/);
  assert.match(adminSrc, /requireAdminContext\(req, res, 'security'\)/);
  assert.equal(hasAdminPermission(['finance'], 'finance'), true);
  assert.equal(hasAdminPermission(['editorial'], 'finance'), false);
});

test('A3: pagamento só é confirmado pelo webhook em reserva/assinatura pending_payment com valor exato', () => {
  assert.equal(
    isExactApprovedPendingPayment({
      currentStatus: 'confirmed',
      expectedAmountCents: 10000,
      mpStatus: 'approved',
      transactionAmountBrl: 100,
    }).ok,
    false
  );
  assert.equal(
    isExactApprovedPendingPayment({
      currentStatus: 'pending_payment',
      expectedAmountCents: 10000,
      mpStatus: 'approved',
      transactionAmountBrl: 99,
    }).ok,
    false
  );
  assert.equal(
    isExactApprovedPendingPayment({
      currentStatus: 'pending_payment',
      expectedAmountCents: 10000,
      mpStatus: 'approved',
      transactionAmountBrl: 100,
    }).ok,
    true
  );
});

test('A4: papel de admin/sub-admin só vale com e-mail verificado (igual às regras do Firestore)', () => {
  assert.equal(isVerifiedAdminIdentity({ emailVerified: true, role: 'admin' }), true);
  assert.equal(isVerifiedAdminIdentity({ emailVerified: false, role: 'admin' }), false);
  assert.equal(isVerifiedAdminIdentity({ emailVerified: true, role: 'subadmin' }), true);
  assert.equal(isVerifiedAdminIdentity({ emailVerified: false, role: 'subadmin' }), false);
  assert.equal(isVerifiedAdminIdentity({ emailVerified: true, role: 'tourist' }), false);

  const authSrc = read('api/_lib/auth.ts');
  assert.match(authSrc, /const emailVerified = decoded\.email_verified === true;/);
  assert.match(authSrc, /ctx\.authUser\.email_verified !== true/);
});

test('A5: modais têm semântica de diálogo para leitores de tela', () => {
  for (const file of [
    'FrocRotaAIModal',
    'DestinationDetailModal',
    'ListingDetailModal',
    'LegalComplianceModal',
    'PWAInstallButton',
  ]) {
    const source = read(`src/components/${file}.tsx`);
    assert.match(source, /<div role="dialog" aria-modal="true" aria-label=/, file);
  }
});
