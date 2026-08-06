import path from 'node:path';

export interface CursoInfo {
  nome: string;
  codEmec: string;
  turno: string;
  regulatory: string;
}

export interface FaculdadeInfo {
  nome: string;
  cnpj: string;
  email: string;
  telefone: string;
  endereco: string;
  diretor: string;
  cargoDiretor: string;
  rodape: string;
  enade: string;
  registroRtd: string;
  logoPath: string | null;
  cursos: Record<string, CursoInfo>;
}

const SEM_LOGO: Partial<FaculdadeInfo> = {
  cnpj: '',
  email: '',
  telefone: '',
  endereco: '',
  diretor: '',
  cargoDiretor: 'Diretor Geral',
  rodape: '',
  enade: '',
  registroRtd: '',
  logoPath: null,
  cursos: {},
};

export const FACULDADES_INFO: Record<string, FaculdadeInfo> = {
  'Hélio Rocha': {
    nome: 'FACULDADE HÉLIO ROCHA',
    cnpj: '03.466.601/0001-82',
    email: 'joseaugusto@faculdadeheliorocha.com.br',
    telefone: '(71) 9 2003-7875 (WhatsApp Institucional)',
    endereco:
      'Avenida Leovigildo Filgueiras, n. 81 a 85, Garcia, Salvador - Bahia, CEP 40.100-000',
    diretor: 'Prof. Dr. José Augusto Maciel Torres',
    cargoDiretor: 'Diretor Geral',
    rodape:
      'QUALQUER INFORMAÇÃO, DEVE SER SOLICITADA ATRAVÉS DO NOSSO E-MAIL: joseaugusto@faculdadeheliorocha.com.br , OU ATRAVÉS DO WHATSAPP (71) 9 2003-7875.',
    enade: 'Aluno dispensado de acordo com o Calendário Trienal',
    registroRtd: '',
    logoPath: path.join(__dirname, '..', 'resources', 'logo-helio-rocha.png'),
    cursos: {
      Administração: {
        nome: 'Bacharelado em Administração',
        codEmec: '106513',
        turno: 'Noturno',
        regulatory:
          'Autorização do Curso: Portaria nº 211 de 08 de fevereiro de 2001. Renovação de Reconhecimento de Curso: Portaria nº 706, de 10 de novembro de 2016',
      },
      'Comunicação Social (Publicidade e Propaganda)': {
        nome: 'Bacharelado em Comunicação Social - Publicidade e Propaganda',
        codEmec: '46290',
        turno: 'Noturno',
        regulatory:
          'Autorização do Curso: Portaria nº 602 de 28 de março de 2001. Renovação de Reconhecimento de Curso: Portaria nº 930, de 24 de agosto de 2017',
      },
      'Engenharia Civil': {
        nome: 'Bacharelado em Engenharia Civil',
        codEmec: '1169327',
        turno: 'Noturno',
        regulatory:
          'Autorização de Curso Portaria nº 406 - MEC de 30/08/2013',
      },
      'Engenharia de Produção': {
        nome: 'Bacharelado em Engenharia de Produção',
        codEmec: '1177416',
        turno: 'Noturno',
        regulatory:
          'Portaria nº 120 - MEC de 15/03/2013, publicado no DOU de 18/03/2013',
      },
      'Engenharia Elétrica': {
        nome: 'Bacharelado em Engenharia Elétrica',
        codEmec: '1169330',
        turno: 'Noturno',
        regulatory: 'Portaria nº 326 - MEC de 24/07/2013',
      },
      'Fisioterapia': {
        nome: 'Bacharelado em Fisioterapia',
        codEmec: '1386456',
        turno: 'Noturno',
        regulatory: 'Portaria nº 172 - MEC de 09/04/2019, DOU 10/04/2019',
      },
      'Serviço Social': {
        nome: 'Bacharelado em Serviço Social',
        codEmec: '1165489',
        turno: 'Noturno',
        regulatory:
          'Autorização de Curso: Portaria nº 280 de 19/12/2012. Reconhecimento de Curso: Portaria nº 745, de 14 de julho de 2017.',
      },
      'Sistema de Informação': {
        nome: 'Bacharelado em Sistema de Informação',
        codEmec: '46287',
        turno: 'Noturno',
        regulatory:
          'Autorização do Curso: Portaria nº 348 de 23 de fevereiro de 2001. D.O.U 26/02/2011. Reconhecimento de Curso: Portaria nº 490, de 09 de fevereiro de 2006. D.O.U 10/02/2006',
      },
      'Turismo': {
        nome: 'Bacharelado em Turismo',
        codEmec: '46282',
        turno: 'Noturno',
        regulatory:
          'Autorização do Curso: Portaria nº 210 de 08 de fevereiro de 2001. Reconhecimento de Curso: Portaria nº 490 de 09 de fevereiro de 2006',
      },
    },
  },
  FACIIP: {
    nome: 'FACIIP - FACULDADE DE CIÊNCIAS INTEGRADAS IPITANGA',
    cnpj: '',
    email: 'contato@faciip.com.br',
    telefone: '(71) 9 2003-7875',
    endereco: '',
    diretor: 'Prof. Dr. José Augusto Maciel Torres',
    cargoDiretor: 'Diretor Geral',
    rodape:
      'QUALQUER INFORMAÇÃO, DEVE SER SOLICITADA ATRAVÉS DO NOSSO E-MAIL: contato@faciip.com.br, OU ATRAVÉS DO WHATSAPP (71) 9 2003-7875.',
    enade: 'Estudante dispensado de realização do ENADE, em razão do calendário trienal',
    registroRtd:
      'Registro de Títulos e Documentos, sob o Nº 965, Registrado no Livro A-1 Sob o Nº 113 do Registro de Pessoas Jurídicas em 13/05/1996',
    logoPath: path.join(__dirname, '..', 'resources', 'logo-faciip.png'),
    cursos: {
      'Administração': {
        nome: 'Administração',
        codEmec: '',
        turno: 'Noturno',
        regulatory:
          'Autorização do Curso Portaria nº 744 - MEC de 06/05/1999 publicado no D.O.U de 07/05/1999, pelo Reconhecimento do Curso, Portaria nº 2.650 de 27/07/2005 publicado no D.O.U de 28/07/2005, com Renovação de Reconhecimento de Curso, Portaria nº 931 de 24/08/2017 e D.O.U de 28/08/2017.',
      },
      'Administração Hospitalar': {
        nome: 'Administração Com Habilitação em Administração Hospitalar',
        codEmec: '',
        turno: 'Noturno',
        regulatory:
          'Autorização do Curso Portaria nº 744 - MEC de 06/05/1999 publicado no D.O.U de 07/05/1999, pelo Reconhecimento do Curso, Portaria nº 2.650 de 27/07/2005 publicado no D.O.U de 28/07/2005, com Renovação de Reconhecimento de Curso, Portaria nº 931 de 24/08/2017 e D.O.U de 28/08/2017.',
      },
      'Comunicação Social (Relações Públicas)': {
        nome: 'Comunicação Social Com Habilitação em Relações Públicas',
        codEmec: '',
        turno: 'Noturno',
        regulatory:
          'Autorização do Curso Portaria Nº 107 - MEC de 10/02/2000 com Renovação de Curso Portaria Nº 311 - MEC de 30 de janeiro de 2006 - D.O.U de 31/01/2006',
      },
      'Ciências Contábeis': {
        nome: 'CIÊNCIAS CONTÁBEIS',
        codEmec: '',
        turno: 'Noturno',
        regulatory:
          'Autorizado pela Portaria Nº 111 - MEC de 26/06/2012 - D.O.U 28/06/2012. Reconhecido pela Portaria Nº 705 - MEC de 18/12/2013 - D.O.U de 19/12/2013',
      },
      'Engenharia de Produção Mecânica': {
        nome: 'ENGENHARIA DE PRODUÇÃO MECÂNICA',
        codEmec: '',
        turno: 'Noturno',
        regulatory:
          'Autorização do Curso Portaria Nº 79 - MEC de 14/01/1999 com Renovação de Reconhecimento de Curso Portaria Nº 278 - MEC de 01/04/2015 - D.O.U de 02/04/2015',
      },
      'Jornalismo': {
        nome: 'Comunicação Social Com Habilitação em Jornalismo',
        codEmec: '',
        turno: 'Noturno',
        regulatory:
          'Autorização do Curso Portaria Nº 1.809 - MEC de 17/12/1999 - D.O.U 20/12/1999 com Renovação de Curso Portaria Nº 584 - MEC de 09/12/2020 - D.O.U de 11/12/2020',
      },
      'Pedagogia': {
        nome: 'Pedagogia - Licenciatura',
        codEmec: '107330',
        turno: 'Noturno',
        regulatory:
          'Autorização do Curso Portaria Nº 1.457 - MEC de 23/12/1998 com Renovação de Reconhecimento de Curso Portaria Nº 1094 - MEC de 24/12/2015 - D.O.U de 30/12/2015',
      },
      'Turismo e Hotelaria': {
        nome: 'TURISMO E HOTELARIA',
        codEmec: '',
        turno: 'Noturno',
        regulatory:
          'Autorização do Curso Portaria Nº 1.106 - MEC de 28/09/1998 com Renovação de Reconhecimento de Curso Portaria Nº 1.099 - MEC de 29/04/2004 - D.O.U de 03/05/2004',
      },
    },
  } as FaculdadeInfo,
  FATECE: {
    nome: 'Faculdade Tecnologia de Ciências e Educação - FATECE',
    cnpj: '30.159.458/0001-59',
    email: 'secretaria@faculdadefatece.com.br',
    telefone: '(71) 9 2003-7875 (WhatsApp Institucional)',
    endereco: 'Rua Manoel Oliveira e Silva, n. 127, Campus Universitário, Ipirá - BA, CEP 44600-000',
    diretor: 'Prof. Dr. José Augusto Maciel Torres',
    cargoDiretor: 'Diretor Geral',
    rodape: 'QUALQUER INFORMAÇÃO, DEVE SER SOLICITADA ATRAVÉS DO NOSSO E-MAIL: secretaria@faculdadefatece.com.br, OU ATRAVÉS DO WHATSAPP (71) 9 2003-7875.',
    enade: 'Aluno dispensado de acordo com o Calendário Trienal',
    registroRtd: '',
    logoPath: path.join(__dirname, '..', 'resources', 'logo-fatece.png'),
    cursos: {
      'Administração': { nome: 'Bacharelado em Administração', codEmec: '1261187', turno: 'Noturno', regulatory: 'Autorização do Curso: Portaria nº 254 de 17 de março de 2015, DOU de 18 de março de 2015.' },
      'Pedagogia': { nome: 'Licenciatura em Pedagogia', codEmec: '105812', turno: 'Noturno', regulatory: 'Autorização do Curso: Portaria nº 3.530 de 29 de outubro de 2004, DOU de 01 de novembro de 2004.' },
      'Teologia': { nome: 'Bacharelado em Teologia', codEmec: '1180229', turno: 'Noturno', regulatory: 'Autorização do Curso: Portaria nº 326 de 24 de julho de 2013, DOU de 25 de julho de 2013.' },
    },
  } as FaculdadeInfo,
  FACEI: {
    ...SEM_LOGO,
    nome: 'FACEI - FACULDADE DE CIÊNCIAS EMPRESARIAIS',
  } as FaculdadeInfo,
  '2 de Julho': {
    ...SEM_LOGO,
    nome: 'FACULDADE 2 DE JULHO',
  } as FaculdadeInfo,
};

export function getFaculdadeInfo(nome: string | null | undefined): FaculdadeInfo {
  if (nome && FACULDADES_INFO[nome]) return FACULDADES_INFO[nome];
  return {
    ...SEM_LOGO,
    nome: nome ?? 'FACULDADE',
  } as FaculdadeInfo;
}

export const TITULACOES = ['DOUTOR', 'DOUTORA', 'MESTRADO', 'MESTRADO/DOUTORADO', 'ESPECIALISTA'] as const;
export const STATUS_DISCIPLINA = ['AP', 'REP', 'CUMP', 'MAT', 'TRANC'] as const;
