/**
 * Google Gemini REST API client for Step 1 (analyzeJob) and Step 2 (generateResume).
 * Uses strict responseSchema + retry with exponential backoff and jitter (HTTP 429 & 5xx).
 */

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MAX_ATTEMPTS = 3;
const GEMINI_MAX_RETRY_AFTER_MS = 20000;

/**
 * Returns the strict responseSchema for Step 1 (`analyzeJob`).
 * @returns {object}
 */
function getAnalyzeJobResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      company: { type: 'STRING' },
      role: { type: 'STRING' },
      language: { type: 'STRING', enum: ['PT', 'EN'] },
      keywords: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        minItems: 1,
        maxItems: 15,
      },
      gapAnalysis: {
        type: 'OBJECT',
        properties: {
          hasPracticalContext: { type: 'ARRAY', items: { type: 'STRING' } },
          underHighlighted: { type: 'ARRAY', items: { type: 'STRING' } },
          realGaps: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['hasPracticalContext', 'underHighlighted', 'realGaps'],
      },
      validationQuestions: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' },
            technology: { type: 'STRING' },
            reason: { type: 'STRING' },
            question: { type: 'STRING' },
            suggestedDefault: { type: 'BOOLEAN' },
          },
          required: ['id', 'technology', 'reason', 'question', 'suggestedDefault'],
        },
      },
      extractedJobSummary: { type: 'STRING' },
    },
    required: [
      'company',
      'role',
      'language',
      'keywords',
      'gapAnalysis',
      'validationQuestions',
      'extractedJobSummary',
    ],
  };
}

/**
 * Returns the strict responseSchema for Step 2 (`generateResume`).
 * @returns {object}
 */
function getGenerateResumeResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      language: { type: 'STRING', enum: ['PT', 'EN'] },
      summary: { type: 'STRING' },
      experiences: {
        type: 'ARRAY',
        minItems: 1,
        items: {
          type: 'OBJECT',
          properties: {
            company: { type: 'STRING' },
            role: { type: 'STRING' },
            period: { type: 'STRING' },
            bullets: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 1 },
          },
          required: ['company', 'role', 'period', 'bullets'],
        },
      },
      skills: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        minItems: 4,
        maxItems: 5,
      },
      education: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        minItems: 1,
      },
      courses: { type: 'STRING' },
      highlightsSummary: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        minItems: 3,
        maxItems: 5,
      },
      gapsSummary: { type: 'STRING' },
    },
    required: [
      'language',
      'summary',
      'experiences',
      'skills',
      'education',
      'courses',
      'highlightsSummary',
      'gapsSummary',
    ],
  };
}

/**
 * Extracts the concatenated answer text from a generateContent response, ignoring
 * "thought" parts emitted by thinking models.
 * @param {object} decoded
 * @returns {string}
 */
function extractCandidateText(decoded) {
  const candidate = decoded && Array.isArray(decoded.candidates) ? decoded.candidates[0] : null;
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts)
    ? candidate.content.parts
    : [];
  return parts
    .filter((part) => part && typeof part.text === 'string' && part.thought !== true)
    .map((part) => part.text)
    .join('')
    .trim();
}

/**
 * Computes how long to wait before the next retry, honoring Retry-After when present.
 * @param {number} attempt
 * @param {GoogleAppsScript.URL_Fetch.HTTPResponse} [response]
 * @returns {number}
 */
function computeGeminiRetryDelayMs(attempt, response) {
  const backoff = calculateBackoffDelayMs(attempt);
  if (!response) {
    return backoff;
  }
  const headers = response.getHeaders() || {};
  const retryAfterRaw = headers['Retry-After'] || headers['retry-after'];
  const retryAfterSeconds = Number(retryAfterRaw);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(GEMINI_MAX_RETRY_AFTER_MS, Math.max(backoff, retryAfterSeconds * 1000));
  }
  return backoff;
}

/**
 * Executes a Gemini generateContent REST request with exponential backoff + jitter retry
 * (up to GEMINI_MAX_ATTEMPTS attempts for HTTP 429/500/502/503/504 and network errors).
 * @param {ReturnType<typeof getAppConfig>} config
 * @param {{
 *   model: string,
 *   systemInstruction: string,
 *   parts: Array<object>,
 *   responseSchema: object,
 *   temperature?: number,
 *   trace?: object
 * }} options
 * @returns {{ parsed: object, modelUsed: string, tokensIn: number, tokensOut: number, attempts: number }}
 */
function callGeminiGenerateContent(config, options) {
  const model = normalizeModelName(options.model);
  if (!model) {
    throw new Error('CONFIG_MISSING: Nome do modelo Gemini ausente.');
  }

  const endpoint = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
  const payload = {
    systemInstruction: {
      parts: [{ text: options.systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: options.parts,
      },
    ],
    generationConfig: {
      temperature: typeof options.temperature === 'number' ? options.temperature : 0.2,
      responseMimeType: 'application/json',
      responseSchema: options.responseSchema,
    },
  };
  const requestBody = JSON.stringify(payload);

  const trace = options.trace || null;
  // TODO(observability): iniciar span 'gemini' (trace.startSpan('gemini')).
  if (trace) {
    trace.setModel(model);
  }

  let lastError = null;
  for (let attempt = 0; attempt < GEMINI_MAX_ATTEMPTS; attempt += 1) {
    const isLastAttempt = attempt === GEMINI_MAX_ATTEMPTS - 1;
    let response;
    try {
      response = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': config.geminiApiKey },
        payload: requestBody,
        muteHttpExceptions: true,
      });
    } catch (networkErr) {
      lastError = new Error(
        `GEMINI_NETWORK: ${networkErr && networkErr.message ? networkErr.message : String(networkErr)}`
      );
      // TODO(observability): trace.log('WARN', 'gemini_network_retry', { attempt }).
      if (!isLastAttempt) {
        Utilities.sleep(computeGeminiRetryDelayMs(attempt));
        continue;
      }
      throw lastError;
    }

    const statusCode = response.getResponseCode();
    const rawBody = response.getContentText() || '';

    if (statusCode >= 200 && statusCode < 300) {
      let decoded;
      try {
        decoded = JSON.parse(rawBody);
      } catch {
        throw new Error('SCHEMA_INVALID: Resposta da API Gemini não é um JSON válido.');
      }

      if (decoded.promptFeedback && decoded.promptFeedback.blockReason) {
        throw new Error(`GEMINI_BLOCKED: Requisição bloqueada pela API (${decoded.promptFeedback.blockReason}).`);
      }

      const candidate = Array.isArray(decoded.candidates) ? decoded.candidates[0] : null;
      const finishReason = candidate && candidate.finishReason ? candidate.finishReason : '';
      if (finishReason === 'MAX_TOKENS') {
        throw new Error('GEMINI_MAX_TOKENS: Resposta do modelo truncada por limite de tokens.');
      }
      if (finishReason === 'SAFETY' || finishReason === 'RECITATION' || finishReason === 'PROHIBITED_CONTENT') {
        throw new Error(`GEMINI_BLOCKED: Resposta interrompida pelo modelo (${finishReason}).`);
      }

      const candidateText = extractCandidateText(decoded);
      if (!candidateText) {
        throw new Error('SCHEMA_INVALID: Resposta da API Gemini veio sem conteúdo textual.');
      }

      let parsed;
      try {
        parsed = JSON.parse(candidateText);
      } catch {
        throw new Error('SCHEMA_INVALID: JSON retornado pelo modelo está malformado.');
      }

      const usage = decoded.usageMetadata || {};
      const tokensIn = typeof usage.promptTokenCount === 'number' ? usage.promptTokenCount : 0;
      const tokensOut = typeof usage.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0;

      // TODO(observability): registrar tokens e encerrar span 'gemini' (trace.endSpan('gemini')).
      if (trace) {
        trace.addTokens(tokensIn, tokensOut);
      }

      return {
        parsed,
        modelUsed: model,
        tokensIn,
        tokensOut,
        attempts: attempt + 1,
      };
    }

    if (isRetryableHttpStatus(statusCode)) {
      lastError = new Error(`GEMINI_${statusCode}: Erro transitório da API Gemini (HTTP ${statusCode}).`);
      // TODO(observability): trace.log('WARN', 'gemini_retry', { attempt, statusCode }).
      if (!isLastAttempt) {
        Utilities.sleep(computeGeminiRetryDelayMs(attempt, response));
        continue;
      }
      throw lastError;
    }

    // Non-retryable 4xx: fail fast (never echo request data or the API key).
    throw new Error(`GEMINI_${statusCode}: Erro da API Gemini (HTTP ${statusCode}): ${rawBody.slice(0, 300)}`);
  }

  throw lastError || new Error('GEMINI_UNKNOWN: Falha inesperada ao chamar a API Gemini.');
}

/**
 * Step 1: Executes Etapas 1, 2 and 3 of Master Database to produce gap analysis and
 * validation questions (mandatory pause before resume generation).
 * @param {ReturnType<typeof getAppConfig>} config
 * @param {{
 *   model: string,
 *   masterDatabaseText: string,
 *   baseResumeText: string,
 *   jobUrl: string,
 *   text: string,
 *   images?: Array<{ mimeType: string, data: string }>,
 *   trace?: object
 * }} params
 * @returns {{ data: object, modelUsed: string, tokensIn: number, tokensOut: number }}
 */
function analyzeJobWithGemini(config, params) {
  const systemInstruction = [
    'Você é o motor ATS TailorOps executando RIGOROSAMENTE as Etapas 1, 2 e 3 da Master Database do candidato.',
    'Siga as instruções e regras escritas na própria Master Database; em caso de conflito, a Master Database prevalece.',
    'Regras obrigatórias:',
    '1) Nunca invente fatos, experiências ou tecnologias que não constem na Master Database.',
    '2) Detecte o idioma principal da vaga ("PT" ou "EN") e extraia exatamente as 15 palavras-chave técnicas/competências mais importantes, exatamente como escritas na vaga (ou menos, se a vaga não tiver 15).',
    '3) Compare os requisitos da vaga contra a Master Database e o Currículo ATS Base, classificando em gapAnalysis: hasPracticalContext, underHighlighted e realGaps.',
    '4) Gere validationQuestions objetivas (ids únicos "q1", "q2"...) para a Pausa Obrigatória da Etapa 3 sempre que houver tecnologias/práticas da vaga com possível vivência não explícita ou sub-destacada.',
    '5) Produza extractedJobSummary com resumo limpo e completo dos requisitos, responsabilidades e stack da vaga para uso posterior na Etapa 4.',
    '6) Se houver imagens anexadas, elas são prints da vaga: transcreva e use o conteúdo delas como descrição da vaga.',
  ].join('\n');

  const promptText = [
    '=== MASTER DATABASE (AO VIVO) ===',
    params.masterDatabaseText,
    '',
    '=== CURRÍCULO ATS BASE (AO VIVO) ===',
    params.baseResumeText,
    '',
    '=== DADOS DA VAGA ===',
    `URL: ${params.jobUrl}`,
    params.text
      ? `DESCRIÇÃO EXTRAÍDA:\n${params.text}`
      : 'DESCRIÇÃO EXTRAÍDA: (sem texto — analisar os prints da vaga anexados nesta mensagem)',
  ].join('\n');

  const parts = [{ text: promptText }];
  (Array.isArray(params.images) ? params.images : []).forEach((img) => {
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.data,
      },
    });
  });

  const result = callGeminiGenerateContent(config, {
    model: params.model,
    systemInstruction,
    parts,
    responseSchema: getAnalyzeJobResponseSchema(),
    temperature: 0.2,
    trace: params.trace,
  });

  if (result.parsed && Array.isArray(result.parsed.keywords) && result.parsed.keywords.length > MAX_KEYWORDS) {
    result.parsed.keywords = result.parsed.keywords.slice(0, MAX_KEYWORDS);
  }

  const validation = validateAnalysisResult(result.parsed);
  if (!validation.valid) {
    throw new Error(`SCHEMA_INVALID: Saída de análise inválida: ${validation.errors.join(' ')}`);
  }

  return {
    data: result.parsed,
    modelUsed: result.modelUsed,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}

/**
 * Step 2: Executes Etapa 4 of Master Database after user confirmation in Step 3 pause.
 * @param {ReturnType<typeof getAppConfig>} config
 * @param {{
 *   model: string,
 *   masterDatabaseText: string,
 *   baseResumeText: string,
 *   jobUrl: string,
 *   company: string,
 *   role: string,
 *   language: 'PT' | 'EN',
 *   keywords: string[],
 *   extractedJobSummary: string,
 *   gapAnalysis?: object,
 *   validationAnswers?: Array<{ id?: string, technology: string, include: boolean, context?: string }>,
 *   extraInstructions?: string,
 *   trace?: object
 * }} params
 * @returns {{ data: object, modelUsed: string, tokensIn: number, tokensOut: number }}
 */
function generateResumeWithGemini(config, params) {
  const systemInstruction = [
    'Você é o motor ATS TailorOps executando RIGOROSAMENTE a Etapa 4 da Master Database após a validação da Etapa 3.',
    'Siga as instruções e regras escritas na própria Master Database; em caso de conflito, a Master Database prevalece.',
    'Regras inegociáveis:',
    '1) Zero alucinação: use exclusivamente fatos da Master Database ou explicitamente confirmados pelo candidato nas respostas da Etapa 3 (validationAnswers com include=true). Itens com include=false NÃO podem aparecer no currículo.',
    '2) Escreva todo o currículo no idioma alvo (targetLanguage "PT" ou "EN") com verbos de ação fortes no passado em todos os bullets (nunca use "Responsável por..." / "Responsible for...").',
    '3) summary: 3 a 4 linhas diretas alinhadas à vaga.',
    '4) experiences: priorize Fit Energia e dti digital; inclua Monitoria / Projeto Beira Linha / projetos da Seção 5 somente se diretamente relevantes à vaga e se couberem mantendo o currículo em 1 página. Mantenha a quantidade de bullets próxima à do Currículo ATS Base.',
    '5) skills: 4 a 5 linhas no formato exato "Categoria: item1 | item2 | item3", priorizando as keywords da vaga no início. NUNCA escreva "(Em estudo)" ou "(em aprendizado)".',
    '6) education: entradas da Formação Acadêmica conforme a Master Database.',
    '7) courses: 1 única linha separada por " | ".',
    '8) highlightsSummary: 3 a 5 bullets curtos explicando o foco aplicado, para preparação de entrevista.',
    '9) gapsSummary: texto objetivo resumindo lacunas reais e decisões confirmadas na Etapa 3.',
    '10) language: retorne exatamente o targetLanguage informado.',
  ].join('\n');

  const promptText = [
    '=== MASTER DATABASE (AO VIVO) ===',
    params.masterDatabaseText,
    '',
    '=== CURRÍCULO ATS BASE (AO VIVO) ===',
    params.baseResumeText,
    '',
    '=== CONTEXTO DA VAGA E DECISÕES DA ETAPA 3 ===',
    JSON.stringify(
      {
        jobUrl: params.jobUrl,
        company: params.company,
        role: params.role,
        targetLanguage: params.language,
        keywords: params.keywords || [],
        extractedJobSummary: params.extractedJobSummary,
        gapAnalysis: params.gapAnalysis || {},
        validationAnswers: params.validationAnswers || [],
        extraInstructions: params.extraInstructions || '',
      },
      null,
      2
    ),
  ].join('\n');

  const result = callGeminiGenerateContent(config, {
    model: params.model,
    systemInstruction,
    parts: [{ text: promptText }],
    responseSchema: getGenerateResumeResponseSchema(),
    temperature: 0.3,
    trace: params.trace,
  });

  // The language chosen by the user in the Step 3 pause always wins (drives heading translation).
  if (result.parsed && typeof result.parsed === 'object') {
    result.parsed.language = params.language === 'EN' ? 'EN' : 'PT';
  }

  const validation = validateGeneratedResume(result.parsed);
  if (!validation.valid) {
    throw new Error(`SCHEMA_INVALID: Currículo gerado inválido: ${validation.errors.join(' ')}`);
  }

  return {
    data: result.parsed,
    modelUsed: result.modelUsed,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
