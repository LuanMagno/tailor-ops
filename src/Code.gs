/**
 * Google Apps Script Web App entrypoint and public RPC controller.
 *
 * NOTE: `getTelemetryMetrics()` is declared globally in `ObservabilityService.gs`
 * (stub no-op) and is directly callable via `google.script.run.getTelemetryMetrics()`;
 * it is intentionally NOT redeclared here to avoid a global name collision.
 */

const IDEMPOTENCY_LOCK_TIMEOUT_MS = 5000;
const CACHE_MAX_VALUE_BYTES = 95000;

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
 * Extracts standardized error codes ("CODE: message") from thrown backend Errors.
 * @param {*} err
 * @returns {{ code: string, message: string }}
 */
function formatRpcError(err) {
  const rawMessage = err && err.message ? String(err.message) : String(err || 'Erro interno.');
  const match = /^([A-Z][A-Z0-9_]+):\s*([\s\S]*)$/.exec(rawMessage);
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
 * Builds a cheap, collision-resistant fingerprint for Base64 images (head/middle/tail
 * samples + length) so idempotency keys never hash megabytes of data.
 * @param {Array<{ mimeType?: string, data?: string }>} images
 * @returns {string[]}
 */
function fingerprintImages(images) {
  if (!Array.isArray(images)) {
    return [];
  }
  return images.map((img) => {
    const data = img && typeof img.data === 'string' ? img.data : '';
    const mid = Math.floor(data.length / 2);
    return [
      img && img.mimeType ? img.mimeType : '',
      data.length,
      data.slice(0, 48),
      data.slice(Math.max(0, mid - 24), mid + 24),
      data.slice(-48),
    ].join(':');
  });
}

/**
 * Guards RPC calls against duplicate triggers (double taps, retries) using CacheService (60s).
 * The check-and-set of the IN_PROGRESS marker is serialized with LockService so two
 * concurrent identical requests cannot both pass the guard.
 * @param {string} operation
 * @param {*} keyPayload
 * @param {() => object} handler
 * @param {{ cacheResult?: boolean }} [options] cacheResult=false only blocks concurrent
 *   duplicates and never replays a previous result (required for state toggles).
 * @returns {object}
 */
function runWithIdempotency(operation, keyPayload, handler, options) {
  const cacheResult = !options || options.cacheResult !== false;
  const cache = CacheService.getScriptCache();
  const key = buildIdempotencyKey(operation, keyPayload);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(IDEMPOTENCY_LOCK_TIMEOUT_MS)) {
    return {
      ok: false,
      code: 'BUSY',
      message: 'Servidor ocupado processando outra solicitação. Tente novamente em instantes.',
    };
  }

  try {
    const existing = cache.get(key);
    if (existing === 'IN_PROGRESS') {
      return {
        ok: false,
        code: 'DUPLICATE_REQUEST',
        message: 'Operação idêntica já está em andamento. Aguarde alguns segundos.',
      };
    }
    if (existing && cacheResult) {
      try {
        const replay = JSON.parse(existing);
        replay.idempotentReplay = true;
        return replay;
      } catch {
        cache.remove(key);
      }
    }
    cache.put(key, 'IN_PROGRESS', IDEMPOTENCY_TTL_SECONDS);
  } finally {
    lock.releaseLock();
  }

  try {
    const result = handler();
    if (cacheResult && result && result.ok === true) {
      const serialized = JSON.stringify(result);
      if (Utilities.newBlob(serialized).getBytes().length < CACHE_MAX_VALUE_BYTES) {
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
 * Best-effort input mode detection before extraction (used only to label the trace).
 * @param {object} req
 * @returns {string}
 */
function detectRequestedInputMode(req) {
  if (typeof req.rawCapture === 'string' && req.rawCapture.trim()) {
    return 'bookmarklet';
  }
  if (Array.isArray(req.images) && req.images.length > 0) {
    return 'screenshot';
  }
  if (typeof req.manualText === 'string' && req.manualText.trim()) {
    return 'manual_text';
  }
  return 'url_fetch';
}

/**
 * Step 1 RPC: Extracts job input, reads live Drive docs, and runs Gemini Etapas 1-3.
 * @param {{
 *   jobUrl?: string,
 *   modelTier?: 'HIGH' | 'FAST',
 *   rawCapture?: string,
 *   manualText?: string,
 *   images?: Array<{ mimeType: string, data: string }>
 * }} request
 * @returns {object}
 */
function analyzeJob(request) {
  const req = request && typeof request === 'object' ? request : {};
  const trace = createTrace('analyzeJob', detectRequestedInputMode(req));
  // TODO(observability): medir latência total da operação analyzeJob (total_ms).

  try {
    const idempotencyPayload = {
      jobUrl: typeof req.jobUrl === 'string' ? req.jobUrl.trim() : '',
      modelTier: req.modelTier === 'FAST' ? 'FAST' : 'HIGH',
      rawCapture: req.rawCapture || '',
      manualText: req.manualText || '',
      images: fingerprintImages(req.images),
    };

    return runWithIdempotency('analyzeJob', idempotencyPayload, () => {
      // TODO(observability): trace.startSpan('extract').
      const extracted = extractJobInput(req);
      // TODO(observability): trace.endSpan('extract').

      if (!extracted.ok) {
        trace.setStatus('FALLBACK', extracted.code);
        return extracted;
      }

      const config = getAppConfig();
      const model = resolveGeminiModel(req.modelTier, config);

      // TODO(observability): trace.startSpan('drive').
      const docs = readLiveSourceDocuments(config);
      // TODO(observability): trace.endSpan('drive').

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
        modelTier: idempotencyPayload.modelTier,
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
      jobUrl: typeof req.jobUrl === 'string' ? req.jobUrl : '',
    };
  } finally {
    // TODO(observability): trace.flush() grava a linha da execução na aba Telemetry.
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
  // TODO(observability): medir latência total da operação generateResume (total_ms).

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

    const company = req.company.trim();
    const role = req.role.trim();
    const jobUrl = req.jobUrl.trim();
    const language = req.language === 'EN' ? 'EN' : 'PT';
    const keywords = Array.isArray(req.keywords)
      ? req.keywords.filter((k) => typeof k === 'string' && k.trim()).slice(0, MAX_KEYWORDS)
      : [];
    const validationAnswers = Array.isArray(req.validationAnswers) ? req.validationAnswers : [];
    const extraInstructions = typeof req.extraInstructions === 'string' ? req.extraInstructions.trim() : '';

    const idempotencyPayload = {
      jobUrl,
      company,
      role,
      language,
      modelTier: req.modelTier === 'FAST' ? 'FAST' : 'HIGH',
      validationAnswers,
      extraInstructions,
    };

    return runWithIdempotency('generateResume', idempotencyPayload, () => {
      const config = getAppConfig();
      const model = resolveGeminiModel(req.modelTier, config);

      // TODO(observability): trace.startSpan('drive') para a leitura ao vivo dos Docs.
      const docs = readLiveSourceDocuments(config);
      // TODO(observability): trace.endSpan('drive').

      const geminiResult = generateResumeWithGemini(config, {
        model,
        masterDatabaseText: docs.masterDatabaseText,
        baseResumeText: docs.baseResumeText,
        jobUrl,
        company,
        role,
        language,
        keywords,
        extractedJobSummary: req.extractedJobSummary.trim(),
        gapAnalysis: req.gapAnalysis && typeof req.gapAnalysis === 'object' ? req.gapAnalysis : {},
        validationAnswers,
        extraInstructions,
        trace,
      });

      // TODO(observability): trace.startSpan('drive') para clone + edição in-place.
      const docResult = createTailoredResumeDoc(config, {
        company,
        role,
        resumeData: geminiResult.data,
      });
      // TODO(observability): trace.endSpan('drive').

      const warnings = [];
      if (docResult.onePageCheck.atRisk) {
        warnings.push('O conteúdo ficou maior que o currículo base: revise no Google Docs se ele continua em 1 página.');
      }
      if (docResult.missingSections.length > 0) {
        warnings.push(`Seções não encontradas no Currículo Base e não preenchidas: ${docResult.missingSections.join(', ')}.`);
      }

      const application = createBacklogApplication(config, {
        company,
        role,
        language,
        jobUrl,
        docUrl: docResult.docUrl,
        pdfUrl: docResult.pdfUrl,
        keywords,
        highlightsSummary: geminiResult.data.highlightsSummary,
        gapsSummary: geminiResult.data.gapsSummary,
        metadata: {
          docId: docResult.docId,
          filename: docResult.filename,
          modelUsed: geminiResult.modelUsed,
          inputMode: req.inputMode || 'n/a',
          onePageCheck: docResult.onePageCheck,
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
        warnings,
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
    // TODO(observability): trace.flush() grava a linha da execução na aba Telemetry.
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
    const items = listBacklogApplications(getAppConfig());
    trace.setStatus('OK');
    return {
      ok: true,
      items,
      statuses: STATUS_LIST.slice(),
    };
  } catch (err) {
    const formatted = formatRpcError(err);
    trace.setStatus('ERROR', formatted.code);
    return {
      ok: false,
      code: formatted.code,
      message: formatted.message,
      items: [],
      statuses: STATUS_LIST.slice(),
    };
  } finally {
    // TODO(observability): trace.flush() no finally.
    trace.flush();
  }
}

/**
 * Updates status, notes, or metadata of an application in the Backlog tab.
 * Results are NOT replayed from cache: toggling A -> B -> A within 60s must persist.
 * @param {{ id: string, status?: string, notes?: string, metadata?: object }} patch
 * @returns {object}
 */
function updateApplication(patch) {
  const trace = createTrace('updateApplication', 'n/a');
  // TODO(observability): medir duração da atualização no Backlog.

  try {
    return runWithIdempotency(
      'updateApplication',
      patch || {},
      () => {
        const application = updateBacklogApplication(getAppConfig(), patch);
        trace.setStatus('OK');
        return {
          ok: true,
          application,
        };
      },
      { cacheResult: false }
    );
  } catch (err) {
    const formatted = formatRpcError(err);
    trace.setStatus('ERROR', formatted.code);
    return {
      ok: false,
      code: formatted.code,
      message: formatted.message,
    };
  } finally {
    // TODO(observability): trace.flush() no finally.
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
 * Validates all 7 ScriptProperties and read access to both Docs, the output Folder and the
 * Spreadsheet (Backlog headers A..N and Telemetry A..M). Never writes anything.
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
      configured: REQUIRED_SCRIPT_PROPERTIES.slice(),
      geminiApiKey: '***redacted***',
      modelHigh: config.modelHigh,
      modelFast: config.modelFast,
    };
  } catch (err) {
    report.ok = false;
    report.scriptProperties = { ok: false, ...formatRpcError(err) };
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

    let headerMismatches = [];
    if (backlogSheet && backlogSheet.getLastColumn() >= 1) {
      const headerRow = backlogSheet
        .getRange(1, 1, 1, BACKLOG_HEADERS.length)
        .getValues()[0]
        .map((v) => String(v).trim());
      headerMismatches = BACKLOG_HEADERS
        .map((expected, i) => (headerRow[i] === expected ? null : `${String.fromCharCode(65 + i)}: esperado "${expected}", encontrado "${headerRow[i]}"`))
        .filter(Boolean);
    }

    const telemetryColumns = telemetrySheet ? telemetrySheet.getLastColumn() : 0;
    const spreadsheetOk = Boolean(backlogSheet && telemetrySheet) &&
      headerMismatches.length === 0 &&
      telemetryColumns >= TELEMETRY_COLUMN_COUNT;

    report.resources.backlogSpreadsheet = {
      ok: spreadsheetOk,
      name: ss.getName(),
      hasBacklogTab: Boolean(backlogSheet),
      backlogDataRows: backlogSheet ? Math.max(0, backlogSheet.getLastRow() - 1) : 0,
      backlogHeaderMismatches: headerMismatches,
      hasTelemetryTab: Boolean(telemetrySheet),
      telemetryColumns,
      expectedTelemetryColumns: TELEMETRY_COLUMN_COUNT,
    };
    if (!spreadsheetOk) {
      report.ok = false;
    }
  } catch (err) {
    report.ok = false;
    report.resources.backlogSpreadsheet = { ok: false, ...formatRpcError(err) };
  }

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
