/**
 * Google Drive & Docs service for live reading of Master Database / Base Resume,
 * cloning into OUTPUT_FOLDER_ID, and surgical in-place ATS resume updates.
 */

/**
 * Reads the live text content of Master Database and Base ATS Resume on every run.
 * @param {ReturnType<typeof getAppConfig>} config
 * @returns {{
 *   masterDatabaseText: string,
 *   baseResumeText: string,
 *   masterDbName: string,
 *   baseResumeName: string
 * }}
 */
function readLiveSourceDocuments(config) {
  const masterDoc = DocumentApp.openById(config.masterDbDocId);
  const baseDoc = DocumentApp.openById(config.baseResumeDocId);

  return {
    masterDatabaseText: masterDoc.getBody().getText(),
    baseResumeText: baseDoc.getBody().getText(),
    masterDbName: masterDoc.getName(),
    baseResumeName: baseDoc.getName(),
  };
}

/**
 * Returns text of a body child if it is a Paragraph or ListItem; otherwise empty string.
 * @param {GoogleAppsScript.Document.Element} child
 * @returns {string}
 */
function getBodyChildText(child) {
  const type = child.getType();
  if (type === DocumentApp.ElementType.PARAGRAPH) {
    return child.asParagraph().getText();
  }
  if (type === DocumentApp.ElementType.LIST_ITEM) {
    return child.asListItem().getText();
  }
  return '';
}

/**
 * Inspects the Base ATS Resume read-only and reports which canonical section anchors exist.
 * Used by testHealthCheck().
 * @param {string} baseResumeDocId
 * @returns {{ foundKeys: string[], missingKeys: string[] }}
 */
function inspectBaseResumeAnchors(baseResumeDocId) {
  const doc = DocumentApp.openById(baseResumeDocId);
  const body = doc.getBody();
  const foundSet = {};
  const total = body.getNumChildren();

  for (let i = 0; i < total; i += 1) {
    const anchorKey = detectSectionAnchor(getBodyChildText(body.getChild(i)));
    if (anchorKey) {
      foundSet[anchorKey] = true;
    }
  }

  const allKeys = ['summary', 'experience', 'skills', 'education', 'courses'];
  const foundKeys = allKeys.filter((k) => foundSet[k] === true);
  const missingKeys = allKeys.filter((k) => foundSet[k] !== true);
  return { foundKeys, missingKeys };
}

/**
 * Copies non-null element attributes while explicitly stripping HEADING so
 * inserted content never inherits a default Google Docs Heading style.
 * @param {object} rawAttrs
 * @returns {object}
 */
function sanitizeParagraphAttributes(rawAttrs) {
  const clean = {};
  if (!rawAttrs || typeof rawAttrs !== 'object') {
    return clean;
  }
  Object.keys(rawAttrs).forEach((key) => {
    if (key === String(DocumentApp.Attribute.HEADING)) {
      return;
    }
    if (rawAttrs[key] !== null && rawAttrs[key] !== undefined) {
      clean[key] = rawAttrs[key];
    }
  });
  return clean;
}

/**
 * Captures uniform text attributes (font, size, color, italic) from index 0 of a Text element.
 * @param {GoogleAppsScript.Document.Text} textEl
 * @param {{ includeBold?: boolean }} [options]
 * @returns {object}
 */
function captureTextAttributes(textEl, options) {
  const clean = {};
  if (!textEl || textEl.getText().length === 0) {
    return clean;
  }
  const includeBold = options && options.includeBold === true;
  const rawAttrs = textEl.getAttributes(0);
  if (!rawAttrs || typeof rawAttrs !== 'object') {
    return clean;
  }
  Object.keys(rawAttrs).forEach((key) => {
    if (!includeBold && key === String(DocumentApp.Attribute.BOLD)) {
      return;
    }
    if (rawAttrs[key] !== null && rawAttrs[key] !== undefined) {
      clean[key] = rawAttrs[key];
    }
  });
  return clean;
}

/**
 * Applies captured text attributes across the entire Text element if non-empty.
 * @param {GoogleAppsScript.Document.Text} textEl
 * @param {object} attrs
 */
function applyTextAttributes(textEl, attrs) {
  if (!textEl || textEl.getText().length === 0 || !attrs || Object.keys(attrs).length === 0) {
    return;
  }
  textEl.setAttributes(0, textEl.getText().length - 1, attrs);
}

/**
 * Captures styling templates from existing elements inside a section range [start .. end].
 * @param {GoogleAppsScript.Document.Body} body
 * @param {number} start
 * @param {number} end
 * @returns {{
 *   paragraphAttrs: object,
 *   paragraphTextAttrs: object,
 *   listItemAttrs: object,
 *   listItemTextAttrs: object,
 *   glyphType: GoogleAppsScript.Document.GlyphType | null,
 *   nestingLevel: number,
 *   preferListItem: boolean
 * }}
 */
function captureSectionTemplates(body, start, end) {
  const templates = {
    paragraphAttrs: {},
    paragraphTextAttrs: {},
    listItemAttrs: {},
    listItemTextAttrs: {},
    glyphType: null,
    nestingLevel: 0,
    preferListItem: false,
  };

  let capturedParagraph = false;
  let capturedListItem = false;

  for (let i = start; i <= end; i += 1) {
    const child = body.getChild(i);
    const type = child.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH && !capturedParagraph) {
      const p = child.asParagraph();
      if (p.getText().trim().length > 0) {
        templates.paragraphAttrs = sanitizeParagraphAttributes(p.getAttributes());
        templates.paragraphTextAttrs = captureTextAttributes(p.editAsText());
        capturedParagraph = true;
      }
    } else if (type === DocumentApp.ElementType.LIST_ITEM && !capturedListItem) {
      const li = child.asListItem();
      if (li.getText().trim().length > 0) {
        templates.listItemAttrs = sanitizeParagraphAttributes(li.getAttributes());
        templates.listItemTextAttrs = captureTextAttributes(li.editAsText());
        templates.glyphType = li.getGlyphType();
        templates.nestingLevel = li.getNestingLevel();
        templates.preferListItem = true;
        capturedListItem = true;
      }
    }
  }

  return templates;
}

/**
 * Inserts a styled normal paragraph (never Heading) into body.
 * @param {GoogleAppsScript.Document.Body} body
 * @param {number} index
 * @param {string} text
 * @param {object} paragraphAttrs
 * @param {object} textAttrs
 * @returns {GoogleAppsScript.Document.Paragraph}
 */
function insertStyledParagraph(body, index, text, paragraphAttrs, textAttrs) {
  const p = body.insertParagraph(index, text);
  if (paragraphAttrs && Object.keys(paragraphAttrs).length > 0) {
    p.setAttributes(paragraphAttrs);
  }
  const textEl = p.editAsText();
  applyTextAttributes(textEl, textAttrs);
  return p;
}

/**
 * Inserts a styled list item preserving bullet glyph and nesting level.
 * @param {GoogleAppsScript.Document.Body} body
 * @param {number} index
 * @param {string} text
 * @param {ReturnType<typeof captureSectionTemplates>} templates
 * @returns {GoogleAppsScript.Document.ListItem}
 */
function insertStyledListItem(body, index, text, templates) {
  const li = body.insertListItem(index, text);
  if (templates.listItemAttrs && Object.keys(templates.listItemAttrs).length > 0) {
    li.setAttributes(templates.listItemAttrs);
  }
  if (templates.glyphType) {
    li.setGlyphType(templates.glyphType);
  }
  if (typeof templates.nestingLevel === 'number') {
    li.setNestingLevel(templates.nestingLevel);
  }
  const textEl = li.editAsText();
  const baseTextAttrs = Object.keys(templates.listItemTextAttrs).length > 0
    ? templates.listItemTextAttrs
    : templates.paragraphTextAttrs;
  applyTextAttributes(textEl, baseTextAttrs);
  if (text.length > 0) {
    textEl.setBold(0, text.length - 1, false);
  }
  return li;
}

/**
 * Replaces a section's body elements in-place by inserting new elements BEFORE removing old ones.
 * @param {GoogleAppsScript.Document.Body} body
 * @param {'summary'|'experience'|'skills'|'education'|'courses'} sectionKey
 * @param {number} anchorIndex
 * @param {number} sectionEndIndex
 * @param {object} resumeData
 */
function replaceSectionContent(body, sectionKey, anchorIndex, sectionEndIndex, resumeData) {
  const start = anchorIndex + 1;
  const templates = start <= sectionEndIndex
    ? captureSectionTemplates(body, start, sectionEndIndex)
    : captureSectionTemplates(body, 0, Math.max(0, anchorIndex - 1));

  const oldCount = sectionEndIndex >= start ? (sectionEndIndex - start + 1) : 0;
  let insertCursor = start;

  if (sectionKey === 'summary') {
    const p = insertStyledParagraph(
      body,
      insertCursor,
      resumeData.summary.trim(),
      templates.paragraphAttrs,
      templates.paragraphTextAttrs
    );
    if (p.getText().length > 0) {
      p.editAsText().setBold(0, p.getText().length - 1, false);
    }
    insertCursor += 1;
  } else if (sectionKey === 'experience') {
    resumeData.experiences.forEach((exp) => {
      const headerLine = `${exp.role.trim()} — ${exp.company.trim()} | ${exp.period.trim()}`;
      const headerParagraph = insertStyledParagraph(
        body,
        insertCursor,
        headerLine,
        templates.paragraphAttrs,
        templates.paragraphTextAttrs
      );
      const headerTextEl = headerParagraph.editAsText();
      const pipeIdx = headerLine.indexOf(' | ');
      if (pipeIdx > 0) {
        headerTextEl.setBold(0, pipeIdx - 1, true);
        headerTextEl.setBold(pipeIdx, headerLine.length - 1, false);
      } else if (headerLine.length > 0) {
        headerTextEl.setBold(0, headerLine.length - 1, true);
      }
      insertCursor += 1;

      exp.bullets.forEach((bullet) => {
        insertStyledListItem(body, insertCursor, bullet.trim(), templates);
        insertCursor += 1;
      });
    });
  } else if (sectionKey === 'skills') {
    resumeData.skills.forEach((rawLine) => {
      const line = rawLine.trim();
      const element = templates.preferListItem
        ? insertStyledListItem(body, insertCursor, line, templates)
        : insertStyledParagraph(
          body,
          insertCursor,
          line,
          templates.paragraphAttrs,
          templates.paragraphTextAttrs
        );
      const textEl = element.editAsText();
      const colonIdx = line.indexOf(':');
      if (colonIdx >= 0) {
        textEl.setBold(0, colonIdx, true);
        if (colonIdx + 1 <= line.length - 1) {
          textEl.setBold(colonIdx + 1, line.length - 1, false);
        }
      } else if (line.length > 0) {
        textEl.setBold(0, line.length - 1, false);
      }
      insertCursor += 1;
    });
  } else if (sectionKey === 'education') {
    resumeData.education.forEach((rawEntry) => {
      const entry = rawEntry.trim();
      const element = templates.preferListItem
        ? insertStyledListItem(body, insertCursor, entry, templates)
        : insertStyledParagraph(
          body,
          insertCursor,
          entry,
          templates.paragraphAttrs,
          templates.paragraphTextAttrs
        );
      if (entry.length > 0) {
        element.editAsText().setBold(0, entry.length - 1, false);
      }
      insertCursor += 1;
    });
  } else if (sectionKey === 'courses') {
    const coursesLine = resumeData.courses.trim();
    const p = insertStyledParagraph(
      body,
      insertCursor,
      coursesLine,
      templates.paragraphAttrs,
      templates.paragraphTextAttrs
    );
    if (coursesLine.length > 0) {
      p.editAsText().setBold(0, coursesLine.length - 1, false);
    }
    insertCursor += 1;
  }

  // Remove original elements in reverse order AFTER new elements are in place
  const oldStart = insertCursor;
  const oldEnd = insertCursor + oldCount - 1;
  for (let idx = oldEnd; idx >= oldStart; idx -= 1) {
    body.removeChild(body.getChild(idx));
  }
}

/**
 * Clones the Base ATS Resume into OUTPUT_FOLDER_ID and edits all sections in-place.
 * @param {ReturnType<typeof getAppConfig>} config
 * @param {{ company: string, role: string, resumeData: object }} params
 * @returns {{ docId: string, filename: string, docUrl: string, pdfUrl: string }}
 */
function createTailoredResumeDoc(config, params) {
  const validation = validateGeneratedResume(params.resumeData);
  if (!validation.valid) {
    throw new Error(`SCHEMA_INVALID: Currículo gerado inválido: ${validation.errors.join(' ')}`);
  }

  const filename = buildResumeFilename(params.company, params.role);
  const baseFile = DriveApp.getFileById(config.baseResumeDocId);
  const outputFolder = DriveApp.getFolderById(config.outputFolderId);
  const clonedFile = baseFile.makeCopy(filename, outputFolder);
  const docId = clonedFile.getId();

  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();
  const totalChildren = body.getNumChildren();
  const anchors = [];

  for (let i = 0; i < totalChildren; i += 1) {
    const key = detectSectionAnchor(getBodyChildText(body.getChild(i)));
    if (key) {
      anchors.push({ key, index: i });
    }
  }

  if (anchors.length === 0) {
    doc.saveAndClose();
    throw new Error('BASE_TEMPLATE_INVALID: Nenhuma seção âncora encontrada no Currículo Base.');
  }

  // Process bottom-to-top so upper child indices remain stable
  for (let a = anchors.length - 1; a >= 0; a -= 1) {
    const current = anchors[a];
    const next = a + 1 < anchors.length ? anchors[a + 1] : null;
    let sectionEnd = next ? next.index - 1 : body.getNumChildren() - 1;

    // Preserve one trailing empty spacer paragraph before the next section heading
    if (
      next &&
      sectionEnd > current.index + 1 &&
      getBodyChildText(body.getChild(sectionEnd)).trim().length === 0
    ) {
      sectionEnd -= 1;
    }

    replaceSectionContent(body, current.key, current.index, sectionEnd, params.resumeData);

    // Update section heading text in-place (preserving bottom border & text styling)
    const anchorChild = body.getChild(current.index);
    if (anchorChild.getType() === DocumentApp.ElementType.PARAGRAPH) {
      const anchorTextEl = anchorChild.asParagraph().editAsText();
      const anchorTextAttrs = captureTextAttributes(anchorTextEl, { includeBold: true });
      anchorTextEl.setText(getSectionHeading(current.key, params.resumeData.language));
      applyTextAttributes(anchorTextEl, anchorTextAttrs);
    }
  }

  doc.saveAndClose();
  const urls = buildDocUrls(docId);
  return {
    docId,
    filename,
    docUrl: urls.docUrl,
    pdfUrl: urls.pdfUrl,
  };
}
