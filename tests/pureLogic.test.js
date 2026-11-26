import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  APPLICATION_STATUSES,
  BOOKMARKLET_PREFIX,
  MAX_BOOKMARKLET_TEXT_LENGTH,
  MAX_SCREENSHOT_COUNT,
  RETRYABLE_HTTP_STATUSES,
  BACKLOG_HEADERS,
  isValidApplicationStatus,
  isValidHttpUrl,
  sanitizeFilenameSegment,
  buildResumeFilename,
  parseBookmarkletPayload,
  validateAnalysisResult,
  validateGeneratedResume,
  isRetryableHttpStatus,
  calculateBackoffDelayMs,
  cleanExtractedText,
  validateImageAttachments,
  getSectionHeading,
  detectSectionAnchor,
  generateApplicationId,
  buildDocUrls,
  buildIdempotencyKey,
  serializeBacklogRow,
  deserializeBacklogRow,
} = require('../src/PureLogic.gs');

describe('APPLICATION_STATUSES and isValidApplicationStatus', () => {
  it('exposes the exact 7 allowed statuses in order', () => {
    expect(APPLICATION_STATUSES).toEqual([
      'Gerado',
      'Aplicado',
      'Em Andamento',
      'Proposta',
      'Rejeitado',
      'Desisti',
      'Empresa não retornou',
    ]);
    expect(Object.isFrozen(APPLICATION_STATUSES)).toBe(true);
  });

  it('validates allowed and disallowed statuses', () => {
    for (const status of APPLICATION_STATUSES) {
      expect(isValidApplicationStatus(status)).toBe(true);
    }
    expect(isValidApplicationStatus('gerado')).toBe(false);
    expect(isValidApplicationStatus('Arquivado')).toBe(false);
    expect(isValidApplicationStatus('')).toBe(false);
    expect(isValidApplicationStatus(null)).toBe(false);
    expect(isValidApplicationStatus(undefined)).toBe(false);
  });
});

describe('isValidHttpUrl', () => {
  it('accepts valid http and https URLs', () => {
    expect(isValidHttpUrl('https://www.linkedin.com/jobs/view/12345')).toBe(true);
    expect(isValidHttpUrl('  http://example.com/vaga?id=1  ')).toBe(true);
  });

  it('rejects non-http schemes and malformed strings', () => {
    expect(isValidHttpUrl('ftp://example.com/file')).toBe(false);
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('not a url')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
    expect(isValidHttpUrl(null)).toBe(false);
  });
});

describe('sanitizeFilenameSegment and buildResumeFilename', () => {
  it('formats the filename using the exact required template', () => {
    expect(buildResumeFilename('Nubank', 'Backend Engineer')).toBe(
      'CV- Luan Magno - Nubank - Backend Engineer'
    );
  });

  it('strips invalid Drive/filesystem characters and control characters', () => {
    expect(buildResumeFilename('Fit: Energia/Tech*?', 'Dev <Full> | "Stack"\n\tJr.')).toBe(
      'CV- Luan Magno - Fit Energia Tech - Dev Full Stack Jr'
    );
  });

  it('preserves Portuguese accents and collapses extra spaces', () => {
    expect(sanitizeFilenameSegment('  Solução   Técnica — S.A.  ', 'Cargo')).toBe(
      'Solução Técnica — S.A'
    );
  });

  it('uses fallbacks when company or role is empty or non-string', () => {
    expect(buildResumeFilename('   ///   ', null)).toBe('CV- Luan Magno - Empresa - Cargo');
    expect(buildResumeFilename(undefined, '')).toBe('CV- Luan Magno - Empresa - Cargo');
  });

  it('truncates segments longer than 60 characters cleanly', () => {
    const longCompany = 'A'.repeat(80);
    const segment = sanitizeFilenameSegment(longCompany, 'Empresa');
    expect(segment.length).toBe(60);
  });
});

describe('parseBookmarkletPayload', () => {
  it('parses a valid bookmarklet payload with leading whitespace', () => {
    const raw = `  ${BOOKMARKLET_PREFIX}${JSON.stringify({
      url: 'https://www.linkedin.com/jobs/view/98765',
      title: 'Backend Developer | Acme',
      text: '  Requisitos: Node.js, TypeScript, SQL.  ',
      capturedAt: '2026-11-25T12:00:00Z',
    })}  `;

    const result = parseBookmarkletPayload(raw);
    expect(result).toEqual({
      ok: true,
      data: {
        url: 'https://www.linkedin.com/jobs/view/98765',
        title: 'Backend Developer | Acme',
        text: 'Requisitos: Node.js, TypeScript, SQL.',
        capturedAt: '2026-11-25T12:00:00Z',
      },
    });
  });

  it('supports jobUrl/content aliases and truncates text to 25000 characters', () => {
    const oversized = 'x'.repeat(MAX_BOOKMARKLET_TEXT_LENGTH + 500);
    const raw = `${BOOKMARKLET_PREFIX}${JSON.stringify({
      jobUrl: 'https://boards.greenhouse.io/acme/jobs/1',
      content: oversized,
    })}`;

    const result = parseBookmarkletPayload(raw);
    expect(result.ok).toBe(true);
    expect(result.data.url).toBe('https://boards.greenhouse.io/acme/jobs/1');
    expect(result.data.text.length).toBe(MAX_BOOKMARKLET_TEXT_LENGTH);
    expect(result.data.title).toBe('');
    expect(result.data.capturedAt).toBe('');
  });

  it('returns INVALID_PREFIX when prefix is missing or input is not a string', () => {
    expect(parseBookmarkletPayload('{"url":"https://example.com"}').errorCode).toBe('INVALID_PREFIX');
    expect(parseBookmarkletPayload(null).errorCode).toBe('INVALID_PREFIX');
  });

  it('returns INVALID_JSON when JSON after prefix is malformed', () => {
    const result = parseBookmarkletPayload(`${BOOKMARKLET_PREFIX}{not-json`);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('INVALID_JSON');
  });

  it('returns INVALID_PAYLOAD when JSON is not an object or URL is missing/invalid', () => {
    expect(parseBookmarkletPayload(`${BOOKMARKLET_PREFIX}[]`).errorCode).toBe('INVALID_PAYLOAD');
    expect(
      parseBookmarkletPayload(`${BOOKMARKLET_PREFIX}${JSON.stringify({ title: 'No URL' })}`).errorCode
    ).toBe('INVALID_PAYLOAD');
    expect(
      parseBookmarkletPayload(`${BOOKMARKLET_PREFIX}${JSON.stringify({ url: 'ftp://bad' })}`).errorCode
    ).toBe('INVALID_PAYLOAD');
  });
});

describe('validateAnalysisResult', () => {
  const validAnalysis = {
    company: 'dti digital',
    role: 'Pessoa Desenvolvedora Backend',
    language: 'PT',
    keywords: ['Node.js', 'TypeScript', 'PostgreSQL', 'Docker', 'REST API'],
    gapAnalysis: {
      hasPracticalContext: ['Node.js', 'REST API'],
      underHighlighted: ['PostgreSQL'],
      realGaps: ['Kubernetes'],
    },
    validationQuestions: [
      {
        id: 'q1',
        technology: 'Docker',
        reason: 'Mencionado como diferencial na vaga.',
        question: 'Você já conteinerizou serviços localmente com Docker?',
        suggestedDefault: true,
      },
    ],
    extractedJobSummary: 'Vaga focada em APIs Node.js com PostgreSQL.',
  };

  it('accepts valid PT and EN analysis payloads including empty validationQuestions', () => {
    expect(validateAnalysisResult(validAnalysis)).toEqual({ valid: true, errors: [] });

    const enPayload = {
      ...validAnalysis,
      language: 'EN',
      validationQuestions: [],
    };
    expect(validateAnalysisResult(enPayload)).toEqual({ valid: true, errors: [] });
  });

  it('rejects non-objects and missing or invalid fields', () => {
    expect(validateAnalysisResult(null).valid).toBe(false);

    const invalid = {
      ...validAnalysis,
      company: '',
      language: 'ES',
      keywords: [],
      gapAnalysis: {
        hasPracticalContext: 'Node.js',
        underHighlighted: [],
        realGaps: [123],
      },
      validationQuestions: [
        {
          id: '',
          technology: 'Docker',
          reason: '',
          question: '?',
          suggestedDefault: 'yes',
        },
      ],
      extractedJobSummary: '   ',
    };

    const result = validateAnalysisResult(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(7);
  });
});

describe('validateGeneratedResume', () => {
  const validResume = {
    language: 'PT',
    summary: 'Desenvolvedor Backend com experiência em APIs Node.js, TypeScript e SQL.',
    experiences: [
      {
        company: 'Fit Energia',
        role: 'Desenvolvedor Backend',
        period: '2024 - Atual',
        bullets: [
          'Desenvolveu integrações REST em Node.js e TypeScript reduzindo falhas de sincronização.',
          'Otimizou consultas PostgreSQL para relatórios operacionais.',
        ],
      },
    ],
    skills: [
      'Linguagens e Backend: Node.js | TypeScript | JavaScript | Python',
      'Bancos de Dados: PostgreSQL | MySQL',
    ],
    education: ['Bacharelado em Ciência da Computação — PUC Minas (Em andamento)'],
    courses: 'Arquitetura de Software | Banco de Dados Relacionais | Git e CI/CD',
    highlightsSummary: [
      'Destaque para APIs REST em Node.js e TypeScript alinhado aos requisitos centrais.',
    ],
    gapsSummary: 'Kubernetes marcado como lacuna real; Docker confirmado na Etapa 3.',
  };

  it('accepts valid PT and EN generated resume payloads', () => {
    expect(validateGeneratedResume(validResume)).toEqual({ valid: true, errors: [] });
    expect(validateGeneratedResume({ ...validResume, language: 'EN', gapsSummary: '' })).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects forbidden "(Em estudo)" labels, missing colons in skills, and invalid sections', () => {
    const invalid = {
      ...validResume,
      language: 'FR',
      summary: '',
      experiences: [
        {
          company: 'Fit Energia',
          role: '',
          period: '2024',
          bullets: [],
        },
      ],
      skills: [
        'Sem dois pontos aqui',
        'Cloud: ',
        'Containers: Docker (Em estudo)',
        'Orquestração: Kubernetes (em aprendizado)',
      ],
      education: [],
      courses: '',
      highlightsSummary: [],
      gapsSummary: null,
    };

    const result = validateGeneratedResume(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('(Em estudo)'))).toBe(true);
    expect(result.errors.some((e) => e.includes('":"'))).toBe(true);
    expect(result.errors.length).toBeGreaterThanOrEqual(8);
  });
});

describe('isRetryableHttpStatus and calculateBackoffDelayMs', () => {
  it('identifies retryable 429/5xx statuses and rejects others', () => {
    expect(RETRYABLE_HTTP_STATUSES).toEqual([429, 500, 502, 503, 504]);
    for (const code of [429, 500, 502, 503, 504]) {
      expect(isRetryableHttpStatus(code)).toBe(true);
    }
    for (const code of [200, 400, 401, 403, 404, 422]) {
      expect(isRetryableHttpStatus(code)).toBe(false);
    }
  });

  it('computes exponential backoff deterministically with zero and full jitter', () => {
    expect(calculateBackoffDelayMs(0, { randomFn: () => 0 })).toBe(1000);
    expect(calculateBackoffDelayMs(1, { randomFn: () => 0 })).toBe(2000);
    expect(calculateBackoffDelayMs(2, { randomFn: () => 0 })).toBe(4000);

    expect(calculateBackoffDelayMs(0, { randomFn: () => 1 })).toBe(1250);
    expect(calculateBackoffDelayMs(1, { randomFn: () => 1 })).toBe(2500);
  });

  it('caps backoff at maxDelayMs even with jitter', () => {
    expect(
      calculateBackoffDelayMs(5, { baseDelayMs: 1000, maxDelayMs: 5000, randomFn: () => 1 })
    ).toBe(5000);
  });

  it('throws RangeError for negative or non-integer attempts', () => {
    expect(() => calculateBackoffDelayMs(-1)).toThrow(RangeError);
    expect(() => calculateBackoffDelayMs(1.5)).toThrow(RangeError);
    expect(() => calculateBackoffDelayMs('0')).toThrow(RangeError);
  });
});

describe('cleanExtractedText and validateImageAttachments', () => {
  it('normalizes line breaks, collapses excessive blank lines, and caps length', () => {
    const raw = '  Linha 1\r\n\r\n\r\n\r\nLinha 2  ';
    expect(cleanExtractedText(raw)).toBe('Linha 1\n\nLinha 2');
    expect(cleanExtractedText('abcdef', 3)).toBe('abc');
    expect(cleanExtractedText(null)).toBe('');
  });

  it('validates up to 4 Base64 images and strips data URL prefixes', () => {
    const result = validateImageAttachments([
      { mimeType: 'image/png', data: 'QUJD' },
      { data: 'data:image/jpeg;base64,REVG' },
    ]);
    expect(result).toEqual({
      valid: true,
      normalized: [
        { mimeType: 'image/png', data: 'QUJD' },
        { mimeType: 'image/jpeg', data: 'REVG' },
      ],
      errors: [],
    });
  });

  it('rejects empty arrays, >4 images, unsupported mime types, and invalid base64', () => {
    expect(validateImageAttachments([]).valid).toBe(false);
    expect(
      validateImageAttachments(
        Array.from({ length: MAX_SCREENSHOT_COUNT + 1 }, () => ({ mimeType: 'image/png', data: 'QUJD' }))
      ).valid
    ).toBe(false);
    expect(validateImageAttachments([{ mimeType: 'image/gif', data: 'QUJD' }]).valid).toBe(false);
    expect(validateImageAttachments([{ mimeType: 'image/png', data: 'not-valid!' }]).valid).toBe(false);
  });
});

describe('getSectionHeading and detectSectionAnchor', () => {
  it('returns PT and EN headings and detects anchors case/accent-insensitively', () => {
    expect(getSectionHeading('summary', 'PT')).toBe('RESUMO PROFISSIONAL');
    expect(getSectionHeading('courses', 'EN')).toBe('RELEVANT COURSEWORK');
    expect(() => getSectionHeading('unknown', 'PT')).toThrow();

    expect(detectSectionAnchor('  experiência profissional  ')).toBe('experience');
    expect(detectSectionAnchor('TECHNICAL SKILLS')).toBe('skills');
    expect(detectSectionAnchor('Formacao Academica')).toBe('education');
    expect(detectSectionAnchor('Qualquer outro texto')).toBeNull();
  });
});

describe('generateApplicationId, buildDocUrls, and buildIdempotencyKey', () => {
  it('formats APP-YYYYMMDD-XXXX deterministically when date and suffix are supplied', () => {
    const fixedDate = new Date(2026, 10, 26);
    expect(generateApplicationId(fixedDate, 'ab12')).toBe('APP-20261126-AB12');
    expect(generateApplicationId(fixedDate)).toMatch(/^APP-20261126-[A-Z0-9]{4}$/);
  });

  it('builds edit and direct PDF export URLs from a Google Doc ID', () => {
    expect(buildDocUrls('doc_123')).toEqual({
      docUrl: 'https://docs.google.com/document/d/doc_123/edit',
      pdfUrl: 'https://docs.google.com/document/d/doc_123/export?format=pdf',
    });
    expect(() => buildDocUrls('')).toThrow();
  });

  it('produces deterministic compact idempotency keys independent of object key order', () => {
    const key1 = buildIdempotencyKey('analyzeJob', { a: 1, b: { y: 2, x: 3 } });
    const key2 = buildIdempotencyKey('analyzeJob', { b: { x: 3, y: 2 }, a: 1 });
    const key3 = buildIdempotencyKey('analyzeJob', { a: 2, b: { x: 3, y: 2 } });
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1.length).toBeLessThan(64);
  });
});

describe('serializeBacklogRow and deserializeBacklogRow', () => {
  it('round-trips all 14 columns A..N cleanly', () => {
    expect(BACKLOG_HEADERS.length).toBe(14);
    const record = {
      id: 'APP-20261126-X9K2',
      createdAt: '2026-11-26T00:30:00-03:00',
      company: 'Nubank',
      role: 'Software Engineer',
      language: 'EN',
      status: 'Aplicado',
      jobUrl: 'https://nubank.com.br/jobs/1',
      docUrl: 'https://docs.google.com/document/d/abc/edit',
      pdfUrl: 'https://docs.google.com/document/d/abc/export?format=pdf',
      keywords: ['Clojure', 'Kafka', 'Distributed Systems'],
      highlightsSummary: ['Destaque em mensageria', 'APIs resilientes'],
      gapsSummary: 'Clojure marcado como gap real',
      notes: 'Entrevista agendada',
      metadata: { modelUsed: 'gemini-pro' },
    };

    const row = serializeBacklogRow(record);
    expect(row.length).toBe(14);
    expect(row[0]).toBe('APP-20261126-X9K2');
    expect(row[9]).toBe(JSON.stringify(record.keywords));

    const parsed = deserializeBacklogRow(row);
    expect(parsed).toEqual({
      ...record,
      highlightsSummary: 'Destaque em mensageria\nAPIs resilientes',
    });
  });

  it('handles malformed JSON cells safely when deserializing', () => {
    const parsed = deserializeBacklogRow([
      'APP-20261126-0001',
      '2026-11-26T00:30:00-03:00',
      'Acme',
      'Dev',
      'PT',
      'StatusInvalido',
      'https://acme.com/vaga',
      'https://docs.google.com/d/1/edit',
      'https://docs.google.com/d/1/export?format=pdf',
      '{bad-json',
      'Resumo',
      'Gaps',
      'Notas',
      'not-json',
    ]);
    expect(parsed.status).toBe('Gerado');
    expect(parsed.keywords).toEqual([]);
    expect(parsed.metadata).toEqual({});
  });
});
