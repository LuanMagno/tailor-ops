/**
 * Google Drive & Docs service for live reading of Master Database / Base Resume,
 * cloning into OUTPUT_FOLDER_ID, and surgical in-place ATS resume updates.
 *
 * Editing strategy (preserves the 1-page ATS layout of the base template):
 * - Section headings are edited in place with setText() so paragraph-level styling
 *   (bottom borders, spacing, alignment) is kept; text attributes are re-applied.
 * - Single-paragraph sections (summary, courses) reuse the existing paragraph in place.
 * - Multi-item sections (experience, skills, education) insert new elements styled from
 *   templates captured inside the section BEFORE removing the old ones.
 * - The last paragraph of the body is never removed (Docs forbids it); it is cleared.
 */

const RESUME_SECTION_KEYS = Object.freeze(['summary', 'experience', 'skills', 'education', 'courses']);

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
 * Returns true when a body child is a Paragraph or ListItem (text-bearing block).
 * @param {GoogleAppsScript.Document.Element} child
 * @returns {boolean}
 */
function isTextBlock(child) {
  const type = child.getType();
  return type === DocumentApp.ElementType.PARAGRAPH || type === DocumentApp.ElementType.LIST_ITEM;
}

/**
 * Returns the Paragraph/ListItem wrapper of a body child, or null for other element types.
 * @param {GoogleAppsScript.Document.Element} child
 * @returns {GoogleAppsScript.Document.Paragraph|GoogleAppsScript.Document.ListItem|null}
 */
function asTextBlock(child) {
  const type = child.getType();
  if (type === DocumentApp.ElementType.PARAGRAPH) {
    return child.asParagraph();
  }
  if (type === DocumentApp.ElementType.LIST_ITEM) {
    return child.asListItem();
  }
  return null;
}

/**
 * Returns text of a body child if it is a Paragraph or ListItem; otherwise empty string.
 * @param {GoogleAppsScript.Document.Element} child
 * @returns {string}
 */
function getBodyChildText(child) {
  const block = asTextBlock(child);
  return block ? block.getText() : '';
}

/**
 * Locates the FIRST occurrence of each canonical section anchor, in document order.
 * @param {GoogleAppsScript.Document.Body} body
 * @returns {Array<{ key: string, index: number }>}
 */
function findSectionAnchors(body) {
  const seen = {};
  const anchors = [];
  const total = body.getNumChildren();
  for (let i = 0; i < total; i += 1) {
    const key = detectSectionAnchor(getBodyChildText(body.getChild(i)));
    if (key && !seen[key]) {
      seen[key] = true;
      anchors.push({ key, index: i });
    }
  }
  return anchors;
}

/**
 * Inspects the Base ATS Resume read-only and reports which canonical section anchors exist.
 * Used by testHealthCheck().
 * @param {string} baseResumeDocId
 * @returns {{ foundKeys: string[], missingKeys: string[] }}
 */
function inspectBaseResumeAnchors(baseResumeDocId) {
  const body = DocumentApp.openById(baseResumeDocId).getBody();
  const found = findSectionAnchors(body).map((a) => a.key);
  return {
    foundKeys: RESUME_SECTION_KEYS.filter((k) => found.indexOf(k) >= 0),
    missingKeys: RESUME_SECTION_KEYS.filter((k) => found.indexOf(k) < 0),
  };
}

/**
 * Bounds-safe wrapper around Text.setBold(start, endInclusive, bold).
 * Never throws for empty text, negative indices or ranges past the end.
 * @param {GoogleAppsScript.Document.Text} textEl
 * @param {number} start
 * @param {number} endInclusive
 * @param {boolean} bold
 */
function setBoldSafe(textEl, start, endInclusive, bold) {
  if (!textEl) {
    return;
  }
  const length = textEl.getText().length;
  if (length === 0) {
    return;
  }
  const from = Math.max(0, start);
  const to = Math.min(length - 1, endInclusive);
  if (from > to) {
    return;
  }
  textEl.setBold(from, to, bold);
}

/**
 * Applies "Label:" bold (index 0 through the colon, inclusive) and regular weight after it.
 * Lines without ":" are left fully regular instead of throwing.
 * @param {GoogleAppsScript.Document.Text} textEl
 * @param {string} line
 */
function applyLabelBold(textEl, line) {
  const colonIdx = line.indexOf(':');
  if (colonIdx < 0) {
    setBoldSafe(textEl, 0, line.length - 1, false);
    return;
  }
  setBoldSafe(textEl, 0, colonIdx, true);
  setBoldSafe(textEl, colonIdx + 1, line.length - 1, false);
}

/**
 * Copies non-null attributes, stripping keys that must never be inherited by inserted content:
 * HEADING (no default Heading style), LINK_URL (no accidental hyperlinks) and LIST_ID.
 * @param {object} rawAttrs
 * @param {string[]} [extraExcluded]
 * @returns {object}
 */
function filterAttributes(rawAttrs, extraExcluded) {
  const excluded = [
    String(DocumentApp.Attribute.HEADING),
    String(DocumentApp.Attribute.LINK_URL),
    'LIST_ID',
  ].concat(extraExcluded || []);

  const clean = {};
  if (!rawAttrs || typeof rawAttrs !== 'object') {
    return clean;
  }
  Object.keys(rawAttrs).forEach((key) => {
    if (excluded.indexOf(key) >= 0) {
      return;
    }
    if (rawAttrs[key] !== null && rawAttrs[key] !== undefined) {
      clean[key] = rawAttrs[key];
    }
  });
  return clean;
}

/**
 * Captures text attributes (font family/size, color, italic...) from index 0 of a Text element.
 * @param {GoogleAppsScript.Document.Text} textEl
 * @param {{ includeBold?: boolean }} [options]
 * @returns {object}
 */
function captureTextAttributes(textEl, options) {
  if (!textEl || textEl.getText().length === 0) {
    return {};
  }
  const includeBold = options && options.includeBold === true;
  const extra = includeBold ? [] : [String(DocumentApp.Attribute.BOLD)];
  return filterAttributes(textEl.getAttributes(0), extra);
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
 *   templateListItem: GoogleAppsScript.Document.ListItem | null,
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
    templateListItem: null,
    glyphType: null,
    nestingLevel: 0,
    preferListItem: false,
  };

  let capturedParagraph = false;
  for (let i = Math.max(0, start); i <= end; i += 1) {
    const child = body.getChild(i);
    const type = child.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH && !capturedParagraph) {
      const p = child.asParagraph();
      if (p.getText().trim().length > 0) {
        templates.paragraphAttrs = filterAttributes(p.getAttributes());
        templates.paragraphTextAttrs = captureTextAttributes(p.editAsText());
        capturedParagraph = true;
      }
    } else if (type === DocumentApp.ElementType.LIST_ITEM && !templates.templateListItem) {
      const li = child.asListItem();
      if (li.getText().trim().length > 0) {
        templates.listItemAttrs = filterAttributes(li.getAttributes(), ['GLYPH_TYPE', 'NESTING_LEVEL']);
        templates.listItemTextAttrs = captureTextAttributes(li.editAsText());
        templates.templateListItem = li;
        templates.glyphType = li.getGlyphType();
        templates.nestingLevel = li.getNestingLevel();
        templates.preferListItem = true;
      }
    }
  }

  return templates;
}

/**
 * Inserts a styled NORMAL paragraph (never a Heading) into body.
 * @param {GoogleAppsScript.Document.Body} body
 * @param {number} index
 * @param {string} text
 * @param {ReturnType<typeof captureSectionTemplates>} templates
 * @returns {GoogleAppsScript.Document.Paragraph}
 */
function insertStyledParagraph(body, index, text, templates) {
  const p = body.insertParagraph(index, text);
  p.setHeading(DocumentApp.ParagraphHeading.NORMAL);
  if (Object.keys(templates.paragraphAttrs).length > 0) {
    p.setAttributes(templates.paragraphAttrs);
  }
  applyTextAttributes(p.editAsText(), templates.paragraphTextAttrs);
  return p;
}

/**
 * Inserts a styled list item that joins the template's existing bullet list
 * (same glyph, indentation and nesting) without applying any Heading.
 * @param {GoogleAppsScript.Document.Body} body
 * @param {number} index
 * @param {string} text
 * @param {ReturnType<typeof captureSectionTemplates>} templates
 * @returns {GoogleAppsScript.Document.ListItem}
 */
function insertStyledListItem(body, index, text, templates) {
  const li = body.insertListItem(index, text);
  li.setHeading(DocumentApp.ParagraphHeading.NORMAL);
  if (templates.templateListItem) {
    li.setListId(templates.templateListItem);
  }
  if (Object.keys(templates.listItemAttrs).length > 0) {
    li.setAttributes(templates.listItemAttrs);
  }
  if (templates.glyphType) {
    li.setGlyphType(templates.glyphType);
  }
  li.setNestingLevel(templates.nestingLevel || 0);

  const textAttrs = Object.keys(templates.listItemTextAttrs).length > 0
    ? templates.listItemTextAttrs
    : templates.paragraphTextAttrs;
  const textEl = li.editAsText();
  applyTextAttributes(textEl, textAttrs);
  setBoldSafe(textEl, 0, text.length - 1, false);
  return li;
}

/**
 * Removes a body child, except the last one (Docs forbids removing the final paragraph):
 * a final Paragraph is cleared; a final ListItem gets an empty paragraph appended first.
 * @param {GoogleAppsScript.Document.Body} body
 * @param {number} index
 */
function removeBodyChildSafely(body, index) {
  const child = body.getChild(index);
  const isLast = index === body.getNumChildren() - 1;
  if (isLast) {
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
      child.asParagraph().clear();
      return;
    }
    body.appendParagraph('');
  }
  body.removeChild(child);
}

/**
 * Rewrites a single-paragraph section (summary/courses) reusing its first text block in place.
 * @param {GoogleAppsScript.Document.Body} body
 * @param {number} start
 * @param {number} end
 * @param {string} newText
 * @returns {boolean} false when the section has no reusable block.
 */
function rewriteSingleBlockSection(body, start, end, newText) {
  let reuseIndex = -1;
  for (let i = start; i <= end; i += 1) {
    const child = body.getChild(i);
    if (isTextBlock(child) && getBodyChildText(child).trim().length > 0) {
      reuseIndex = i;
      break;
    }
  }
  if (reuseIndex < 0) {
    return false;
  }

  const textEl = asTextBlock(body.getChild(reuseIndex)).editAsText();
  const textAttrs = captureTextAttributes(textEl);
  textEl.setText(newText);
  applyTextAttributes(textEl, textAttrs);
  setBoldSafe(textEl, 0, newText.length - 1, false);

  for (let idx = end; idx >= start; idx -= 1) {
    if (idx !== reuseIndex) {
      removeBodyChildSafely(body, idx);
    }
  }
  return true;
}

/**
 * Replaces a section's body elements in place.
 * @param {GoogleAppsScript.Document.Body} body
 * @param {'summary'|'experience'|'skills'|'education'|'courses'} sectionKey
 * @param {number} anchorIndex
 * @param {number} sectionEndIndex
 * @param {object} resumeData
 */
function replaceSectionContent(body, sectionKey, anchorIndex, sectionEndIndex, resumeData) {
  const start = anchorIndex + 1;
  const hasContent = sectionEndIndex >= start;

  if (hasContent && (sectionKey === 'summary' || sectionKey === 'courses')) {
    const text = sectionKey === 'summary' ? resumeData.summary.trim() : resumeData.courses.trim();
    if (rewriteSingleBlockSection(body, start, sectionEndIndex, text)) {
      return;
    }
  }

  // Empty section: borrow styling from the content right above the anchor.
  const templates = hasContent
    ? captureSectionTemplates(body, start, sectionEndIndex)
    : captureSectionTemplates(body, 0, anchorIndex - 1);
  const oldCount = hasContent ? sectionEndIndex - start + 1 : 0;
  let cursor = start;

  const insertLine = (line, asListItem) => {
    const element = asListItem && templates.preferListItem
      ? insertStyledListItem(body, cursor, line, templates)
      : insertStyledParagraph(body, cursor, line, templates);
    cursor += 1;
    return element.editAsText();
  };

  if (sectionKey === 'summary') {
    const line = resumeData.summary.trim();
    setBoldSafe(insertLine(line, false), 0, line.length - 1, false);
  } else if (sectionKey === 'courses') {
    const line = resumeData.courses.trim();
    setBoldSafe(insertLine(line, false), 0, line.length - 1, false);
  } else if (sectionKey === 'experience') {
    resumeData.experiences.forEach((exp) => {
      const header = `${exp.role.trim()} — ${exp.company.trim()} | ${exp.period.trim()}`;
      const headerText = insertLine(header, false);
      const pipeIdx = header.lastIndexOf(' | ');
      if (pipeIdx > 0) {
        setBoldSafe(headerText, 0, pipeIdx - 1, true);
        setBoldSafe(headerText, pipeIdx, header.length - 1, false);
      } else {
        setBoldSafe(headerText, 0, header.length - 1, true);
      }
      exp.bullets.forEach((bullet) => {
        const line = bullet.trim();
        setBoldSafe(insertLine(line, true), 0, line.length - 1, false);
      });
    });
  } else if (sectionKey === 'skills') {
    resumeData.skills.forEach((rawLine) => {
      const line = rawLine.trim();
      applyLabelBold(insertLine(line, true), line);
    });
  } else if (sectionKey === 'education') {
    resumeData.education.forEach((rawEntry) => {
      const line = rawEntry.trim();
      setBoldSafe(insertLine(line, true), 0, line.length - 1, false);
    });
  }

  // Remove the original elements (now shifted right after the inserted ones), bottom-up.
  for (let idx = cursor + oldCount - 1; idx >= cursor; idx -= 1) {
    removeBodyChildSafely(body, idx);
  }
}

/**
 * Rewrites a section heading in place, translating it to EN when needed while keeping
 * paragraph styling (bottom border, spacing) and text attributes (font, size, bold).
 * @param {GoogleAppsScript.Document.Body} body
 * @param {number} anchorIndex
 * @param {string} heading
 */
function rewriteSectionHeading(body, anchorIndex, heading) {
  const block = asTextBlock(body.getChild(anchorIndex));
  if (!block) {
    return;
  }
  const textEl = block.editAsText();
  if (textEl.getText().trim() === heading) {
    return;
  }
  const attrs = captureTextAttributes(textEl, { includeBold: true });
  textEl.setText(heading);
  applyTextAttributes(textEl, attrs);
}

/**
 * Counts text-bearing blocks (paragraphs + list items) in the body.
 * @param {GoogleAppsScript.Document.Body} body
 * @returns {number}
 */
function countTextBlocks(body) {
  let count = 0;
  const total = body.getNumChildren();
  for (let i = 0; i < total; i += 1) {
    if (isTextBlock(body.getChild(i))) {
      count += 1;
    }
  }
  return count;
}

/**
 * Clones the Base ATS Resume into OUTPUT_FOLDER_ID and edits all sections in place.
 * @param {ReturnType<typeof getAppConfig>} config
 * @param {{ company: string, role: string, resumeData: object }} params
 * @returns {{
 *   docId: string,
 *   filename: string,
 *   docUrl: string,
 *   pdfUrl: string,
 *   missingSections: string[],
 *   onePageCheck: { atRisk: boolean, charRatio: number, paragraphDelta: number }
 * }}
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
  const baseChars = body.getText().length;
  const baseParagraphs = countTextBlocks(body);
  const anchors = findSectionAnchors(body);

  if (anchors.length === 0) {
    doc.saveAndClose();
    clonedFile.setTrashed(true);
    throw new Error('BASE_TEMPLATE_INVALID: Nenhuma seção âncora encontrada no Currículo Base.');
  }

  const language = params.resumeData.language === 'EN' ? 'EN' : 'PT';

  // Bottom-to-top so the indices of sections above stay valid.
  for (let a = anchors.length - 1; a >= 0; a -= 1) {
    const current = anchors[a];
    const next = a + 1 < anchors.length ? anchors[a + 1] : null;
    let sectionEnd = next ? next.index - 1 : body.getNumChildren() - 1;

    // Keep one empty spacer paragraph right before the next heading.
    if (
      next &&
      sectionEnd > current.index + 1 &&
      getBodyChildText(body.getChild(sectionEnd)).trim().length === 0
    ) {
      sectionEnd -= 1;
    }

    replaceSectionContent(body, current.key, current.index, sectionEnd, params.resumeData);
    rewriteSectionHeading(body, current.index, getSectionHeading(current.key, language));
  }

  const onePageCheck = assessOnePageRisk({
    baseChars,
    baseParagraphs,
    newChars: body.getText().length,
    newParagraphs: countTextBlocks(body),
  });

  doc.saveAndClose();
  const urls = buildDocUrls(docId);
  const foundKeys = anchors.map((a) => a.key);
  return {
    docId,
    filename,
    docUrl: urls.docUrl,
    pdfUrl: urls.pdfUrl,
    missingSections: RESUME_SECTION_KEYS.filter((k) => foundKeys.indexOf(k) < 0),
    onePageCheck,
  };
}
