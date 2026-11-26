/**
 * Configuration loader and global backend constants for TailorOps.
 * Reads all secrets and Drive/Sheets IDs exclusively from ScriptProperties.
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

const STATUS_LIST = APPLICATION_STATUSES;
const BACKLOG_SHEET_NAME = 'Backlog';
const TELEMETRY_SHEET_NAME = 'Telemetry';
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
  const missing = [];

  REQUIRED_SCRIPT_PROPERTIES.forEach((key) => {
    if (typeof props[key] !== 'string' || props[key].trim().length === 0) {
      missing.push(key);
    }
  });

  if (missing.length > 0) {
    throw new Error(`CONFIG_MISSING: Propriedades do script ausentes: ${missing.join(', ')}`);
  }

  return Object.freeze({
    geminiApiKey: props.GEMINI_API_KEY.trim(),
    masterDbDocId: props.MASTER_DB_DOC_ID.trim(),
    baseResumeDocId: props.BASE_RESUME_DOC_ID.trim(),
    outputFolderId: props.OUTPUT_FOLDER_ID.trim(),
    backlogSheetId: props.BACKLOG_SHEET_ID.trim(),
    modelHigh: props.MODEL_HIGH.trim(),
    modelFast: props.MODEL_FAST.trim(),
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
  if (normalized === 'FAST') {
    return config.modelFast;
  }
  return config.modelHigh;
}

/**
 * Returns non-sensitive configuration metadata safe to expose to the Web App UI.
 * @returns {{
 *   statuses: readonly string[],
 *   defaultModelTier: 'HIGH',
 *   models: { HIGH: string, FAST: string },
 *   maxImages: number
 * }}
 */
function getPublicConfigInfo() {
  const config = getAppConfig();
  return {
    statuses: STATUS_LIST,
    defaultModelTier: 'HIGH',
    models: {
      HIGH: config.modelHigh,
      FAST: config.modelFast,
    },
    maxImages: MAX_SCREENSHOT_COUNT,
  };
}
