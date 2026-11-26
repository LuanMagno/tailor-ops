import { describe, test } from 'vitest';

describe('calculatePercentile (TODO - implementação manual SRE)', () => {
  test.todo('calcula o percentil P95 corretamente para uma lista não ordenada de latências');
  test.todo('retorna 0 quando o array de valores está vazio');
  test.todo('lida com arrays de 1 único elemento retornando esse próprio valor');
  test.todo('lança erro quando o percentil está fora do intervalo [0, 100]');
});

describe('computeSliSummary (TODO - implementação manual SRE)', () => {
  test.todo('calcula totalRuns, successRate e fallbackRate a partir das linhas da aba Telemetry');
  test.todo('calcula médias (avgMs, avgExtractMs, avgDriveMs, avgGeminiMs) e p95Ms de latência');
  test.todo('agrupa tokens_in e tokens_out por model_used em tokensByModel');
  test.todo('contabiliza execuções por input_mode em byInputMode');
  test.todo('retorna contrato zerado quando a aba Telemetry não possui linhas de dados');
});

describe('ObservabilityService (TODO - implementação manual SRE)', () => {
  test.todo('createTrace gera traceId único, mede spans em ms e persiste linha na aba Telemetry no flush()');
  test.todo('createTrace registra structured logs com timestamp, traceId, level, event e data');
  test.todo('getTelemetryMetrics retorna implemented: true com SLIs calculados a partir da aba Telemetry');
});
