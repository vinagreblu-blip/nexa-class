// ============================================================
// SPIKE M1 — provar que a validação XSD oficial funciona em
// Node/vitest com xmllint-wasm, usando os XSDs REAIS do MEC.
// ============================================================
// O XML de exemplo é INVÁLIDO de propósito: o objetivo do spike
// é provar que a cadeia include/import dos XSDs oficiais resolve
// e que o validador devolve erros estruturados (campo a campo).
// A geração de XML válido é o M3.
import { describe, expect, it } from 'vitest';
import { validarXmlContraXsd } from './xsd-validator';

const NS = 'https://portal.mec.gov.br/diplomadigital/arquivos-em-xsd';

describe('spike: validação XSD oficial MEC v1.05 (xmllint-wasm)', () => {
  it('carrega a cadeia de XSDs oficiais e rejeita XML estruturalmente inválido com erros', async () => {
    const xmlVazio = `<?xml version="1.0" encoding="UTF-8"?><Diploma xmlns="${NS}" xmlns:ds="https://www.w3.org/2000/09/xmldsig#"/>`;
    const r = await validarXmlContraXsd(xmlVazio, 'diploma');
    expect(r.valido).toBe(false);
    expect(r.versaoSchema).toBe('1.05');
    // Erros devem mencionar os elementos obrigatórios ausentes do leiaute real.
    const juntos = r.erros.join('\n');
    expect(juntos).toMatch(/infDiploma/);
    expect(r.erros.length).toBeGreaterThan(0);
  }, 30000);

  it('rejeita XML fora do namespace oficial', async () => {
    const xmlOutro = `<?xml version="1.0" encoding="UTF-8"?><Diploma xmlns="https://nexa-class.edu/diploma"/>`;
    const r = await validarXmlContraXsd(xmlOutro, 'diploma');
    expect(r.valido).toBe(false);
  }, 30000);

  it('valida também o schema da Documentação Acadêmica (conjunto com XSDs encadeados)', async () => {
    const xmlVazio = `<?xml version="1.0" encoding="UTF-8"?><DocumentacaoAcademicaRegistro xmlns="${NS}"/>`;
    const r = await validarXmlContraXsd(xmlVazio, 'documentacaoAcademica');
    expect(r.valido).toBe(false);
    expect(r.erros.join('\n')).toMatch(/RegistroReq/);
  }, 30000);

  it('valida o schema do Histórico Escolar Digital (root DocumentoHistoricoEscolarFinal)', async () => {
    const xmlVazio = `<?xml version="1.0" encoding="UTF-8"?><DocumentoHistoricoEscolarFinal xmlns="${NS}"/>`;
    const r = await validarXmlContraXsd(xmlVazio, 'historicoEscolar');
    expect(r.valido).toBe(false);
    expect(r.erros.length).toBeGreaterThan(0);
  }, 30000);
});
