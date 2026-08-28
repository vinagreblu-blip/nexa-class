// ============================================================
// POLÍTICA DE ASSINATURA OFICIAL (EPES) — digest confirmável
// ============================================================
// O SigPolicyHash é obrigatório no XAdES-EPES e NÃO se inventa: ele deve
// derivar do documento oficial da política. O próprio PA-AD-RC v2.4 declara
// no cabeçalho <ds:Transform Algorithm="exc-c14n#"/> + SHA-256, ou seja, o
// digest é computado sobre a forma EXCLUSIVE-C14N do documento.
//
// Este teste garante que a constante POLITICA_ASSINATURA.digestBase64
// sempre derive do documento oficial (cópia verbatim em fixtures/).
// Valores confirmados em 28/08/2026 por dois motores independentes:
// .NET XmlDsigExcC14NTransform e xml-crypto ExclusiveCanonicalization.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { POLITICA_ASSINATURA, calcularDigestPolitica } from './xades-signer';

const FIXTURE = path.join(__dirname, 'fixtures', 'PA_AD_RC_v2_4.xml');

describe('POLITICA_ASSINATURA (PA-AD-RC v2.4 ICP-Brasil)', () => {
  it('digest deriva do documento oficial (exc-c14n + SHA-256)', () => {
    const oficial = fs.readFileSync(FIXTURE, 'utf8');
    expect(calcularDigestPolitica(oficial)).toBe(POLITICA_ASSINATURA.digestBase64);
  });

  it('digest é SHA-256 de 32 bytes em base64', () => {
    const decodificado = Buffer.from(POLITICA_ASSINATURA.digestBase64, 'base64');
    expect(decodificado).toHaveLength(32);
  });

  it('identificador OID consta no documento oficial', () => {
    const oficial = fs.readFileSync(FIXTURE, 'utf8');
    const oid = POLITICA_ASSINATURA.identificador.replace('urn:oid:', '');
    expect(oficial).toContain(oid);
  });

  it('digest NÃO é o hash dos bytes crus (é sobre a forma canônica)', () => {
    const cru = fs.readFileSync(FIXTURE);
    const shaCru = require('node:crypto')
      .createHash('sha256')
      .update(cru)
      .digest('base64');
    expect(POLITICA_ASSINATURA.digestBase64).not.toBe(shaCru);
  });
});
