/**
 * Hybrid job input extraction service supporting:
 * A) Bookmarklet clipboard payload (TAILOROPS_CAPTURE::)
 * B) Mobile screenshot uploads (up to 4 Base64 images)
 * C) Manual pasted job text
 * D) Single lightweight URL fetch via https://r.jina.ai/<URL> with NEEDS_MANUAL_TEXT fallback
 */

const JINA_READER_BASE_URL = 'https://r.jina.ai/';

const ANTI_BOT_PATTERNS = [
  /just a moment/i,
  /enable javascript and cookies to continue/i,
  /checking your browser/i,
  /cf-browser-verification/i,
  /verify you are human/i,
  /attention required!\s*\|\s*cloudflare/i,
  /access denied/i,
  /captcha/i,
  /target url returned error\s*\d{3}/i,
];

/**
 * Performs a single lightweight GET attempt to r.jina.ai for public job URLs.
 * Never retries anti-bot failures; immediately signals fallback to manual text or screenshots.
 * @param {string} jobUrl
 * @returns {{ ok: boolean, text?: string, reason?: string }}
 */
function fetchJobTextViaJina(jobUrl) {
  const targetUrl = `${JINA_READER_BASE_URL}${jobUrl}`;
  let response;
  try {
    response = UrlFetchApp.fetch(targetUrl, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        Accept: 'text/plain',
        'X-Return-Format': 'text',
      },
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Falha de rede ao consultar r.jina.ai: ${err && err.message ? err.message : String(err)}`,
    };
  }

  const statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    return {
      ok: false,
      reason: `HTTP ${statusCode} ao consultar URL via r.jina.ai.`,
    };
  }

  const cleaned = cleanExtractedText(response.getContentText() || '');
  if (cleaned.length < MIN_EXTRACTED_TEXT_LENGTH) {
    return {
      ok: false,
      reason: `Conteúdo extraído insuficiente (${cleaned.length} caracteres).`,
    };
  }

  const looksLikeBlockPage = ANTI_BOT_PATTERNS.some((pattern) => pattern.test(cleaned)) && cleaned.length < 1500;
  if (looksLikeBlockPage) {
    return {
      ok: false,
      reason: 'Página protegida por verificação anti-bot.',
    };
  }

  return {
    ok: true,
    text: cleaned,
  };
}

/**
 * Normalizes and validates job input from one of the 4 hybrid input modes.
 * @param {{
 *   jobUrl?: string,
 *   rawCapture?: string,
 *   manualText?: string,
 *   images?: Array<{ mimeType?: string, data: string }>
 * }} request
 * @returns {{
 *   ok: boolean,
 *   inputMode?: 'bookmarklet' | 'screenshot' | 'manual_text' | 'url_fetch',
 *   jobUrl?: string,
 *   text?: string,
 *   images?: Array<{ mimeType: string, data: string }>,
 *   code?: string,
 *   message?: string
 * }}
 */
function extractJobInput(request) {
  const req = request && typeof request === 'object' ? request : {};
  const rawCaptureCandidate = typeof req.rawCapture === 'string' && req.rawCapture.trim().length > 0
    ? req.rawCapture
    : (typeof req.manualText === 'string' && req.manualText.trim().startsWith(BOOKMARKLET_PREFIX)
      ? req.manualText
      : '');

  // Mode A: Bookmarklet capture payload
  if (rawCaptureCandidate) {
    const parsedCapture = parseBookmarkletPayload(rawCaptureCandidate);
    if (!parsedCapture.ok) {
      return {
        ok: false,
        inputMode: 'bookmarklet',
        code: 'INVALID_BOOKMARKLET',
        message: parsedCapture.message || 'Payload do bookmarklet inválido.',
      };
    }

    const effectiveUrl = isValidHttpUrl(req.jobUrl) ? req.jobUrl.trim() : parsedCapture.data.url;
    const cleanedCaptureText = cleanExtractedText(parsedCapture.data.text);
    const hasImages = Array.isArray(req.images) && req.images.length > 0;

    if (cleanedCaptureText.length < MIN_EXTRACTED_TEXT_LENGTH && !hasImages) {
      return {
        ok: false,
        inputMode: 'bookmarklet',
        jobUrl: effectiveUrl,
        code: 'NEEDS_MANUAL_TEXT',
        message: 'A captura do bookmarklet trouxe pouco texto. Selecione a descrição da vaga na página ou cole o texto manualmente.',
      };
    }

    let validatedImages = [];
    if (hasImages) {
      const imgCheck = validateImageAttachments(req.images);
      if (!imgCheck.valid) {
        return {
          ok: false,
          inputMode: 'bookmarklet',
          jobUrl: effectiveUrl,
          code: 'INVALID_IMAGES',
          message: imgCheck.errors.join(' '),
        };
      }
      validatedImages = imgCheck.normalized;
    }

    return {
      ok: true,
      inputMode: 'bookmarklet',
      jobUrl: effectiveUrl,
      text: cleanedCaptureText,
      images: validatedImages,
    };
  }

  // All remaining modes require a valid jobUrl
  if (!isValidHttpUrl(req.jobUrl)) {
    return {
      ok: false,
      code: 'INVALID_URL',
      message: 'Informe uma URL válida da vaga (http:// ou https://).',
    };
  }
  const jobUrl = req.jobUrl.trim();
  const manualText = cleanExtractedText(req.manualText || '');

  // Mode B: Mobile screenshot uploads (up to 4 images)
  if (Array.isArray(req.images) && req.images.length > 0) {
    const imgCheck = validateImageAttachments(req.images);
    if (!imgCheck.valid) {
      return {
        ok: false,
        inputMode: 'screenshot',
        jobUrl,
        code: 'INVALID_IMAGES',
        message: imgCheck.errors.join(' '),
      };
    }

    return {
      ok: true,
      inputMode: 'screenshot',
      jobUrl,
      text: manualText,
      images: imgCheck.normalized,
    };
  }

  // Mode C: Manual pasted job text
  if (manualText.length > 0) {
    if (manualText.length < MIN_EXTRACTED_TEXT_LENGTH) {
      return {
        ok: false,
        inputMode: 'manual_text',
        jobUrl,
        code: 'NEEDS_MANUAL_TEXT',
        message: `O texto colado é muito curto (${manualText.length} caracteres). Cole a descrição completa da vaga ou envie prints.`,
      };
    }

    return {
      ok: true,
      inputMode: 'manual_text',
      jobUrl,
      text: manualText,
      images: [],
    };
  }

  // Mode D: Single lightweight URL fetch attempt via r.jina.ai
  const fetchResult = fetchJobTextViaJina(jobUrl);
  if (!fetchResult.ok) {
    return {
      ok: false,
      inputMode: 'url_fetch',
      jobUrl,
      code: 'NEEDS_MANUAL_TEXT',
      message: 'Não foi possível extrair a vaga automaticamente pela URL (site bloqueado ou conteúdo insuficiente). Cole o texto da vaga ou anexe prints mantendo a URL preenchida.',
    };
  }

  return {
    ok: true,
    inputMode: 'url_fetch',
    jobUrl,
    text: fetchResult.text,
    images: [],
  };
}
