/**
 * ObservabilityService (Stub No-Op — Section 6.1).
 *
 * All internal tracing, structured logging, Telemetry sheet writes, and SLI
 * computation are intentionally left unimplemented for manual SRE implementation.
 */

/**
 * Creates a no-op trace handle matching the Section 6.1 instrumentation contract.
 * @param {string} operation Operation name (e.g., 'analyzeJob', 'generateResume').
 * @param {string} inputMode Input mode ('bookmarklet' | 'screenshot' | 'manual_text' | 'url_fetch' | 'n/a').
 * @returns {{
 *   traceId: string,
 *   startSpan: (name: string) => void,
 *   endSpan: (name: string) => void,
 *   setModel: (model: string) => void,
 *   addTokens: (inCount: number, outCount: number) => void,
 *   setStatus: (status: 'OK' | 'FALLBACK' | 'ERROR', errorCode?: string) => void,
 *   log: (level: string, event: string, data?: object) => void,
 *   flush: () => void
 * }}
 */
// eslint-disable-next-line no-unused-vars
function createTrace(operation, inputMode) {
  return {
    traceId: 'noop-trace',
    // eslint-disable-next-line no-unused-vars
    startSpan(name) {
      // TODO(observability): registrar início do span.
    },
    // eslint-disable-next-line no-unused-vars
    endSpan(name) {
      // TODO(observability): registrar fim e duração do span.
    },
    // eslint-disable-next-line no-unused-vars
    setModel(model) {
      // TODO(observability): registrar modelo utilizado na execução.
    },
    // eslint-disable-next-line no-unused-vars
    addTokens(inCount, outCount) {
      // TODO(observability): acumular contagem de tokens de entrada e saída.
    },
    // eslint-disable-next-line no-unused-vars
    setStatus(status, errorCode) {
      // TODO(observability): definir status final ('OK' | 'FALLBACK' | 'ERROR') e errorCode.
    },
    // eslint-disable-next-line no-unused-vars
    log(level, event, data) {
      // TODO(observability): emitir log estruturado.
    },
    flush() {
      // TODO(observability): persistir trace na aba Telemetry.
    },
  };
}

/**
 * Returns the empty SLI metrics contract expected by the "Métricas" UI tab.
 * @returns {{
 *   implemented: boolean,
 *   totalRuns: number,
 *   successRate: number,
 *   fallbackRate: number,
 *   latency: {
 *     avgMs: number,
 *     p95Ms: number,
 *     avgExtractMs: number,
 *     avgDriveMs: number,
 *     avgGeminiMs: number
 *   },
 *   tokensByModel: object,
 *   byInputMode: {
 *     bookmarklet: number,
 *     screenshot: number,
 *     manual_text: number,
 *     url_fetch: number
 *   },
 *   recentTraces: Array
 * }}
 */
function getTelemetryMetrics() {
  return {
    implemented: false,
    totalRuns: 0,
    successRate: 0,
    fallbackRate: 0,
    latency: {
      avgMs: 0,
      p95Ms: 0,
      avgExtractMs: 0,
      avgDriveMs: 0,
      avgGeminiMs: 0,
    },
    tokensByModel: {},
    byInputMode: {
      bookmarklet: 0,
      screenshot: 0,
      manual_text: 0,
      url_fetch: 0,
    },
    recentTraces: [],
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createTrace,
    getTelemetryMetrics,
  };
}
