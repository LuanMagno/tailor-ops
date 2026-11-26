/**
 * Google Sheets repository for the "Backlog" tab (columns A..N).
 */

/**
 * Opens and returns the Backlog sheet tab, validating its existence.
 * @param {ReturnType<typeof getAppConfig>} config
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getBacklogSheet(config) {
  const ss = SpreadsheetApp.openById(config.backlogSheetId);
  const sheet = ss.getSheetByName(BACKLOG_SHEET_NAME);
  if (!sheet) {
    throw new Error(`SHEET_NOT_FOUND: Aba "${BACKLOG_SHEET_NAME}" não encontrada na planilha.`);
  }
  return sheet;
}

/**
 * Lists all applications in the Backlog tab sorted newest-first.
 * @param {ReturnType<typeof getAppConfig>} config
 * @returns {Array<object>}
 */
function listBacklogApplications(config) {
  const sheet = getBacklogSheet(config);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  const values = sheet.getRange(2, 1, lastRow - 1, BACKLOG_HEADERS.length).getValues();
  return values
    .map((row) => deserializeBacklogRow(row))
    .filter((item) => item.id && item.id.trim().length > 0)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/**
 * Inserts a new application row into the Backlog tab with status "Gerado".
 * @param {ReturnType<typeof getAppConfig>} config
 * @param {{
 *   company: string,
 *   role: string,
 *   language: 'PT' | 'EN',
 *   jobUrl: string,
 *   docUrl: string,
 *   pdfUrl: string,
 *   keywords: string[],
 *   highlightsSummary: string[] | string,
 *   gapsSummary: string,
 *   metadata?: object
 * }} input
 * @returns {object}
 */
function createBacklogApplication(config, input) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getBacklogSheet(config);
    const nowIso = Utilities.formatDate(new Date(), APP_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
    const record = {
      id: generateApplicationId(),
      createdAt: nowIso,
      company: input.company,
      role: input.role,
      language: input.language === 'EN' ? 'EN' : 'PT',
      status: 'Gerado',
      jobUrl: input.jobUrl,
      docUrl: input.docUrl,
      pdfUrl: input.pdfUrl,
      keywords: Array.isArray(input.keywords) ? input.keywords : [],
      highlightsSummary: Array.isArray(input.highlightsSummary)
        ? input.highlightsSummary.join('\n')
        : (input.highlightsSummary || ''),
      gapsSummary: typeof input.gapsSummary === 'string' ? input.gapsSummary : '',
      notes: '',
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    };

    const rowValues = serializeBacklogRow(record);
    sheet.appendRow(rowValues);
    return record;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Updates status, notes, and/or metadata of an existing Backlog application row.
 * @param {ReturnType<typeof getAppConfig>} config
 * @param {{ id: string, status?: string, notes?: string, metadata?: object }} patch
 * @returns {object}
 */
function updateBacklogApplication(config, patch) {
  if (!patch || typeof patch.id !== 'string' || patch.id.trim().length === 0) {
    throw new Error('INVALID_INPUT: Campo "id" é obrigatório para atualizar a candidatura.');
  }

  if (patch.status !== undefined && !isValidApplicationStatus(patch.status)) {
    throw new Error(`INVALID_STATUS: Status "${patch.status}" não é permitido.`);
  }

  const targetId = patch.id.trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getBacklogSheet(config);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      throw new Error(`NOT_FOUND: Candidatura "${targetId}" não encontrada.`);
    }

    const rows = sheet.getRange(2, 1, lastRow - 1, BACKLOG_HEADERS.length).getValues();
    let matchedIndex = -1;
    for (let i = 0; i < rows.length; i += 1) {
      if (String(rows[i][0] || '').trim() === targetId) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex < 0) {
      throw new Error(`NOT_FOUND: Candidatura "${targetId}" não encontrada.`);
    }

    const existing = deserializeBacklogRow(rows[matchedIndex]);
    const updated = {
      ...existing,
      status: patch.status !== undefined ? patch.status : existing.status,
      notes: typeof patch.notes === 'string' ? patch.notes : existing.notes,
      metadata: patch.metadata && typeof patch.metadata === 'object'
        ? { ...existing.metadata, ...patch.metadata }
        : existing.metadata,
    };

    const rowNumber = matchedIndex + 2;
    sheet.getRange(rowNumber, 1, 1, BACKLOG_HEADERS.length).setValues([serializeBacklogRow(updated)]);
    return updated;
  } finally {
    lock.releaseLock();
  }
}
