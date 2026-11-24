// Auditoria completa (Claude): o modal renderizado de verdade tem semântica de diálogo.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LegalComplianceModal } from '../src/components/LegalComplianceModal.tsx';

test('A5: modal de termos legais renderiza como diálogo acessível', () => {
  const html = renderToStaticMarkup(<LegalComplianceModal onClose={() => {}} />);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-label="Governança, LGPD, CDC e Termos de Uso"/);
  assert.match(html, /Governança, LGPD, CDC e Termos de Uso/); // o título continua igual
});
