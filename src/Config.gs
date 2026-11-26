/**
 * Configuration loader and global backend constants for TailorOps.
 * Reads all secrets and Drive/Sheets IDs exclusively from ScriptProperties.
 *
 * IMPORTANT (GAS V8 load order): top-level statements in this file must NOT reference
 * symbols declared in other .gs files. clasp pushes files alphabetically, so Config.gs
 * is evaluated before PureLogic.gs and a cross-file reference would throw a
 * ReferenceError at load time, breaking every function in the project.
 * Cross-file symbols may only be used inside function bodies (resolved at call time).
 */

const REQUIRED_SCRIPT_PROPERTIES = Object.freeze([
  'GEMINI_API_KEY',
  'MASTER_DB_DOC_ID',
  'BASE_RESUME_DOC_ID',
  'OUTPUT_FOLDER_ID',
  'BACKLOG_SHEET_ID',
  'MODEL_HIGH',
  'MODEL_FAST',
]);

// Must stay identical to APPLICATION_STATUSES in PureLogic.gs (enforced by unit test).
const STATUS_LIST = Object.freeze([
  'Gerado',
  'Aplicado',
  'Em Andamento',
  'Proposta',
  'Rejeitado',
  'Desisti',
  'Empresa não retornou',
]);

const BACKLOG_SHEET_NAME = 'Backlog';
const TELEMETRY_SHEET_NAME = 'Telemetry';
const TELEMETRY_COLUMN_COUNT = 13;
const IDEMPOTENCY_TTL_SECONDS = 60;
const APP_TIMEZONE = 'America/Sao_Paulo';

/**
 * Loads and validates all 7 required ScriptProperties.
 * @returns {{
 *   geminiApiKey: string,
 *   masterDbDocId: string,
 *   baseResumeDocId: string,
 *   outputFolderId: string,
 *   backlogSheetId: string,
 *   modelHigh: string,
 *   modelFast: string
 * }}
 */
function getAppConfig() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const missing = REQUIRED_SCRIPT_PROPERTIES.filter(
    (key) => typeof props[key] !== 'string' || props[key].trim().length === 0
  );

  if (missing.length > 0) {
    throw new Error(`CONFIG_MISSING: Propriedades do script ausentes: ${missing.join(', ')}`);
  }

  const modelHigh = normalizeModelName(props.MODEL_HIGH);
  const modelFast = normalizeModelName(props.MODEL_FAST);
  if (!modelHigh || !modelFast) {
    throw new Error('CONFIG_MISSING: MODEL_HIGH e MODEL_FAST devem conter nomes de modelo válidos.');
  }

  return Object.freeze({
    geminiApiKey: props.GEMINI_API_KEY.trim(),
    masterDbDocId: props.MASTER_DB_DOC_ID.trim(),
    baseResumeDocId: props.BASE_RESUME_DOC_ID.trim(),
    outputFolderId: props.OUTPUT_FOLDER_ID.trim(),
    backlogSheetId: props.BACKLOG_SHEET_ID.trim(),
    modelHigh,
    modelFast,
  });
}

/**
 * Resolves the Gemini model name based on UI tier selection ('HIGH' by default, or 'FAST').
 * @param {string} modelTier
 * @param {ReturnType<typeof getAppConfig>} config
 * @returns {string}
 */
function resolveGeminiModel(modelTier, config) {
  const normalized = typeof modelTier === 'string' ? modelTier.trim().toUpperCase() : 'HIGH';
  return normalized === 'FAST' ? config.modelFast : config.modelHigh;
}

/**
 * Returns non-sensitive configuration metadata safe to expose to the Web App UI
 * (no API keys and no Drive/Sheets IDs).
 * @returns {{
 *   statuses: string[],
 *   defaultModelTier: 'HIGH',
 *   models: { HIGH: string, FAST: string },
 *   maxImages: number
 * }}
 */
function getPublicConfigInfo() {
  const config = getAppConfig();
  return {
    statuses: STATUS_LIST.slice(),
    defaultModelTier: 'HIGH',
    models: {
      HIGH: config.modelHigh,
      FAST: config.modelFast,
    },
    maxImages: MAX_SCREENSHOT_COUNT,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    REQUIRED_SCRIPT_PROPERTIES,
    STATUS_LIST,
    BACKLOG_SHEET_NAME,
    TELEMETRY_SHEET_NAME,
    TELEMETRY_COLUMN_COUNT,
    IDEMPOTENCY_TTL_SECONDS,
    APP_TIMEZONE,
  };
}
