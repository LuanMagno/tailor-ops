/**
 * Google Apps Script Web App entrypoint and public RPC controller.
 *
 * NOTE: `getTelemetryMetrics()` is declared globally in `ObservabilityService.gs`
 * and is therefore directly callable via `google.script.run.getTelemetryMetrics()`.
 */

/**
 * Serves the mobile-first SPA Web App.
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('TailorOps — ATS Resume & Backlog')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Extracts standardized error codes from thrown backend Errors.
 * @param {*} err
 * @returns {{ code: string, message: string }}
 */
function formatRpcError(err) {
  const rawMessage = err && err.message ? String(err.message) : String(err || 'Erro interno.');
  const match = /^([A-Z0-9_]+):\s*(.*)$/.exec(rawMessage);
  if (match) {
    return {
      code: match[1],
      message: match[2] || rawMessage,
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: rawMessage,
  };
}

/**
 * Guards mutating/expensive RPC calls against duplicate triggers using CacheService (60s).
 * @param {string} operation
 * @param {*} keyPayload
 * @param {() => object} handler
 * @returns {object}
 */
function runWithIdempotency(operation, keyPayload, handler) {
  const cache = CacheService.getScriptCache();
  const key = buildIdempotencyKey(operation, keyPayload);
  const existing = cache.get(key);

  if (existing === 'IN_PROGRESS') {
    return {
      ok: false,
      code: 'DUPLICATE_REQUEST',
      message: 'Operação idêntica já está em andamento. Aguarde alguns segundos.',
    };
  }

  if (existing) {
    try {
      return JSON.parse(existing);
    } catch {
      cache.remove(key);
    }
  }

  cache.put(key, 'IN_PROGRESS', IDEMPOTENCY_TTL_SECONDS);
  try {
    const result = handler();
    if (result && result.ok === true) {
      const serialized = JSON.stringify(result);
      if (serialized.length < 90000) {
        cache.put(key, serialized, IDEMPOTENCY_TTL_SECONDS);
      } else {
        cache.remove(key);
      }
    } else {
      cache.remove(key);
    }
    return result;
  } catch (err) {
    cache.remove(key);
    throw err;
  }
}

/**
 * Step 1 RPC: Extracts job input, reads live Drive docs, and runs Gemini Etapas 1-3.
 * @param {object} request
 * @returns {object}
 */
function analyzeJob(request) {
  const req = request && typeof request === 'object' ? request : {};
  const initialMode = req.rawCapture ? 'bookmarklet' : (req.images && req.images.length ? 'screenshot' : 'manual_text');
  const trace = createTrace('analyzeJob', initialMode);
  // TODO(observability): iniciar spans 'extract', 'drive', 'gemini' e registrar métricas reais.

  try {
    const imageFingerprints = Array.isArray(req.images)
      ? req.images.map((img) => `${img.mimeType || ''}:${String(img.data || '').slice(0, 64)}:${String(img.data || '').length}`)
      : [];

    const idempotencyPayload = {
      jobUrl: req.jobUrl || '',
      modelTier: req.modelTier || 'HIGH',
      rawCapture: req.rawCapture || '',
      manualText: req.manualText || '',
      imageFingerprints,
    };

    return runWithIdempotency('analyzeJob', idempotencyPayload, () => {
      // TODO(observability): trace.startSpan('extract');
      const extracted = extractJobInput(req);
      // TODO(observability): trace.endSpan('extract');

      if (!extracted.ok) {
        trace.setStatus('FALLBACK', extracted.code);
        return extracted;
      }

      const config = getAppConfig();
      const model = resolveGeminiModel(req.modelTier, config);

      // TODO(observability): trace.startSpan('drive');
      const docs = readLiveSourceDocuments(config);
      // TODO(observability): trace.endSpan('drive');

      const geminiResult = analyzeJobWithGemini(config, {
        model,
        masterDatabaseText: docs.masterDatabaseText,
        baseResumeText: docs.baseResumeText,
        jobUrl: extracted.jobUrl,
        text: extracted.text,
        images: extracted.images,
        trace,
      });

      trace.setStatus('OK');
      return {
        ok: true,
        inputMode: extracted.inputMode,
        jobUrl: extracted.jobUrl,
        modelUsed: geminiResult.modelUsed,
        analysis: geminiResult.data,
      };
    });
  } catch (err) {
    const formatted = formatRpcError(err);
    trace.setStatus('ERROR', formatted.code);
    trace.log('ERROR', 'analyzeJob_failed', formatted);
    return {
      ok: false,
      code: formatted.code,
      message: formatted.message,
      jobUrl: req.jobUrl || '',
    };
  } finally {
    // TODO(observability): chamar trace.flush() para gravar linha na aba Telemetry.
    trace.flush();
  }
}

/**
 * Step 2 RPC: Generates tailored resume via Gemini Etapa 4, clones/edits Doc, and logs to Backlog.
 * @param {object} request
 * @returns {object}
 */
function generateResume(request) {
  const req = request && typeof request === 'object' ? request : {};
  const trace = createTrace('generateResume', req.inputMode || 'n/a');
  // TODO(observability): instrumentar spans 'drive', 'gemini', 'backlog' e latência total.

  try {
    if (!isValidHttpUrl(req.jobUrl)) {
      return { ok: false, code: 'INVALID_URL', message: 'URL da vaga inválida ou ausente.' };
    }
    if (typeof req.company !== 'string' || req.company.trim().length === 0) {
      return { ok: false, code: 'INVALID_INPUT', message: 'Nome da empresa é obrigatório.' };
    }
    if (typeof req.role !== 'string' || req.role.trim().length === 0) {
      return { ok: false, code: 'INVALID_INPUT', message: 'Nome do cargo é obrigatório.' };
    }
    if (typeof req.extractedJobSummary !== 'string' || req.extractedJobSummary.trim().length === 0) {
      return { ok: false, code: 'INVALID_INPUT', message: 'Resumo da vaga é obrigatório.' };
    }

    const idempotencyPayload = {
      jobUrl: req.jobUrl.trim(),
      company: req.company.trim(),
      role: req.role.trim(),
      language: req.language === 'EN' ? 'EN' : 'PT',
      modelTier: req.modelTier || 'HIGH',
      validationAnswers: req.validationAnswers || [],
      extraInstructions: req.extraInstructions || '',
    };

    return runWithIdempotency('generateResume', idempotencyPayload, () => {
      const config = getAppConfig();
      const model = resolveGeminiModel(req.modelTier, config);
      const language = req.language === 'EN' ? 'EN' : 'PT';

      // TODO(observability): trace.startSpan('drive');
      const docs = readLiveSourceDocuments(config);
      // TODO(observability): trace.endSpan('drive');

      const geminiResult = generateResumeWithGemini(config, {
        model,
        masterDatabaseText: docs.masterDatabaseText,
        baseResumeText: docs.baseResumeText,
        jobUrl: req.jobUrl.trim(),
        company: req.company.trim(),
        role: req.role.trim(),
        language,
        keywords: Array.isArray(req.keywords) ? req.keywords : [],
        extractedJobSummary: req.extractedJobSummary.trim(),
        gapAnalysis: req.gapAnalysis || {},
        validationAnswers: Array.isArray(req.validationAnswers) ? req.validationAnswers : [],
        extraInstructions: typeof req.extraInstructions === 'string' ? req.extraInstructions.trim() : '',
        trace,
      });

      // TODO(observability): trace.startSpan('drive');
      const docResult = createTailoredResumeDoc(config, {
        company: req.company.trim(),
        role: req.role.trim(),
        resumeData: geminiResult.data,
      });
      // TODO(observability): trace.endSpan('drive');

      const application = createBacklogApplication(config, {
        company: req.company.trim(),
        role: req.role.trim(),
        language,
        jobUrl: req.jobUrl.trim(),
        docUrl: docResult.docUrl,
        pdfUrl: docResult.pdfUrl,
        keywords: Array.isArray(req.keywords) ? req.keywords : [],
        highlightsSummary: geminiResult.data.highlightsSummary,
        gapsSummary: geminiResult.data.gapsSummary,
        metadata: {
          docId: docResult.docId,
          filename: docResult.filename,
          modelUsed: geminiResult.modelUsed,
          inputMode: req.inputMode || 'n/a',
        },
      });

      trace.setStatus('OK');
      return {
        ok: true,
        application,
        docUrl: docResult.docUrl,
        pdfUrl: docResult.pdfUrl,
        filename: docResult.filename,
        highlightsSummary: geminiResult.data.highlightsSummary,
        gapsSummary: geminiResult.data.gapsSummary,
        modelUsed: geminiResult.modelUsed,
      };
    });
  } catch (err) {
    const formatted = formatRpcError(err);
    trace.setStatus('ERROR', formatted.code);
    trace.log('ERROR', 'generateResume_failed', formatted);
    return {
      ok: false,
      code: formatted.code,
      message: formatted.message,
    };
  } finally {
    // TODO(observability): chamar trace.flush() no finally.
    trace.flush();
  }
}

/**
 * Lists all Backlog applications and allowed statuses.
 * @returns {object}
 */
function getBacklog() {
  const trace = createTrace('getBacklog', 'n/a');
  // TODO(observability): medir duração da leitura do Backlog.

  try {
    const config = getAppConfig();
    const items = listBacklogApplications(config);
    trace.setStatus('OK');
    return {
      ok: true,
      items,
      statuses: STATUS_LIST,
    };
  } catch (err) {
    const formatted = formatRpcError(err);
    trace.setStatus('ERROR', formatted.code);
    return {
      ok: false,
      code: formatted.code,
      message: formatted.message,
      items: [],
      statuses: STATUS_LIST,
    };
  } finally {
    // TODO(observability): chamar trace.flush() no finally.
    trace.flush();
  }
}

/**
 * Updates status, notes, or metadata of an application in the Backlog tab.
 * @param {object} patch
 * @returns {object}
 */
function updateApplication(patch) {
  const trace = createTrace('updateApplication', 'n/a');
  // TODO(observability): medir duração da atualização no Backlog.

  try {
    return runWithIdempotency('updateApplication', patch || {}, () => {
      const config = getAppConfig();
      const application = updateBacklogApplication(config, patch);
      trace.setStatus('OK');
      return {
        ok: true,
        application,
      };
    });
  } catch (err) {
    const formatted = formatRpcError(err);
    trace.setStatus('ERROR', formatted.code);
    return {
      ok: false,
      code: formatted.code,
      message: formatted.message,
    };
  } finally {
    // TODO(observability): chamar trace.flush() no finally.
    trace.flush();
  }
}

/**
 * Returns non-sensitive UI configuration (statuses, model names, attachment limits).
 * @returns {object}
 */
function getConfigInfo() {
  try {
    return {
      ok: true,
      config: getPublicConfigInfo(),
    };
  } catch (err) {
    const formatted = formatRpcError(err);
    return {
      ok: false,
      code: formatted.code,
      message: formatted.message,
    };
  }
}

/**
 * Read-only diagnostic utility intended to be executed directly inside the Apps Script Editor.
 * Validates all 7 ScriptProperties and read access to Docs, output Folder, and Spreadsheet.
 * @returns {object}
 */
function testHealthCheck() {
  const report = {
    ok: true,
    checkedAt: Utilities.formatDate(new Date(), APP_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    scriptProperties: {},
    resources: {},
  };

  let config;
  try {
    config = getAppConfig();
    report.scriptProperties = {
      ok: true,
      geminiApiKeyConfigured: Boolean(config.geminiApiKey),
      modelHigh: config.modelHigh,
      modelFast: config.modelFast,
    };
  } catch (err) {
    report.ok = false;
    report.scriptProperties = formatRpcError(err);
    Logger.log(JSON.stringify(report, null, 2));
    return report;
  }

  try {
    const masterDoc = DocumentApp.openById(config.masterDbDocId);
    report.resources.masterDatabase = {
      ok: true,
      name: masterDoc.getName(),
      textLength: masterDoc.getBody().getText().length,
    };
  } catch (err) {
    report.ok = false;
    report.resources.masterDatabase = { ok: false, ...formatRpcError(err) };
  }

  try {
    const baseDoc = DocumentApp.openById(config.baseResumeDocId);
    const anchors = inspectBaseResumeAnchors(config.baseResumeDocId);
    report.resources.baseResume = {
      ok: anchors.missingKeys.length === 0,
      name: baseDoc.getName(),
      textLength: baseDoc.getBody().getText().length,
      foundSectionAnchors: anchors.foundKeys,
      missingSectionAnchors: anchors.missingKeys,
    };
    if (anchors.missingKeys.length > 0) {
      report.ok = false;
    }
  } catch (err) {
    report.ok = false;
    report.resources.baseResume = { ok: false, ...formatRpcError(err) };
  }

  try {
    const folder = DriveApp.getFolderById(config.outputFolderId);
    report.resources.outputFolder = {
      ok: true,
      name: folder.getName(),
    };
  } catch (err) {
    report.ok = false;
    report.resources.outputFolder = { ok: false, ...formatRpcError(err) };
  }

  try {
    const ss = SpreadsheetApp.openById(config.backlogSheetId);
    const backlogSheet = ss.getSheetByName(BACKLOG_SHEET_NAME);
    const telemetrySheet = ss.getSheetByName(TELEMETRY_SHEET_NAME);
    report.resources.backlogSpreadsheet = {
      ok: Boolean(backlogSheet && telemetrySheet),
      name: ss.getName(),
      hasBacklogTab: Boolean(backlogSheet),
      backlogRows: backlogSheet ? backlogSheet.getLastRow() : 0,
      hasTelemetryTab: Boolean(telemetrySheet),
      telemetryRows: telemetrySheet ? telemetrySheet.getLastRow() : 0,
    };
    if (!backlogSheet || !telemetrySheet) {
      report.ok = false;
    }
  } catch (err) {
    report.ok = false;
    report.resources.backlogSpreadsheet = { ok: false, ...formatRpcError(err) };
  }

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
