# Roadmap Técnico — TailorOps

Este documento descreve a evolução planejada do **TailorOps** da arquitetura serverless privada em Google Apps Script (Fase 1) para uma arquitetura cloud-native containerizada (Fase 2).

---

## Fase 1 — Google Apps Script + Gemini API + SRE Lab *(Escopo Atual — v1)*

- [x] Bootstrap Git, ESLint flat config (`.gs` + `.js`), Vitest e manifest V8 (`America/Sao_Paulo`, `access: MYSELF`).
- [x] Camada pura (`src/PureLogic.gs`) desacoplada de serviços proprietários do Apps Script e coberta por testes unitários.
- [x] Extração híbrida anti-bot (Bookmarklet `TAILOROPS_CAPTURE::`, até 4 prints comprimidos via `<canvas>`, texto manual e tentativa única via `r.jina.ai`).
- [x] Fluxo completo em 2 passos respeitando a **Pausa Obrigatória da Etapa 3** da `Master Database`.
- [x] Clonagem e edição cirúrgica *in-place* do `Currículo ATS Base — Luan Magno` + gestão de Backlog em 14 colunas no Google Sheets.
- [x] CI/CD automatizado no GitHub Actions (`ci.yml` + `deploy.yml`).
- [ ] **Laboratório Manual SRE (Desenvolvedor):**
  - Implementação interna de `src/ObservabilityService.gs` (tracing por spans, structured logging e flush na aba `Telemetry`).
  - Implementação manual de `calculatePercentile` e `computeSliSummary` em `src/PureLogic.gs` + ativação dos testes em `tests/observability.test.js`.
  - Preenchimento operacional do `docs/RUNBOOK.md` com SLOs, alertas e playbooks de resposta a incidentes.

---

## Fase 2 — Migração Cloud-Native (Go + Docker + Cloud Run + Terraform + OpenTelemetry)

> **Nota:** A Fase 2 **não** faz parte da implementação da v1. Os contratos JSON estritos (`analyzeJob`, `generateResume`, `getTelemetryMetrics`) e o isolamento em `PureLogic.gs` foram desenhados na Fase 1 justamente para permitir esta migração sem reescrever o modelo de domínio.

### Objetivos da Fase 2
1. **Motor Backend em Go (`golang`):**
   - Serviço HTTP stateless de baixa latência e tipagem forte reutilizando os mesmos contratos JSON de entrada/saída de `analyzeJob` e `generateResume`.
   - Clientes oficiais Google Docs API, Google Drive API, Google Sheets API (ou migração opcional do Backlog para Cloud Firestore / PostgreSQL) e SDK oficial Google GenAI em Go.
   - Concorrência nativa com goroutines (`errgroup`) para leitura paralela de `Master Database` e `Currículo ATS Base`.
2. **Containerização com Docker:**
   - Build multi-stage (`golang:alpine` → `gcr.io/distroless/static-debian12:nonroot`) gerando imagem mínima, imutável e sem shell.
3. **Execução Serverless em Google Cloud Run:**
   - Escala a zero (`min-instances = 0`) mantendo custo próximo de zero em ociosidade, sem as restrições de iframe ou limites do `google.script.run`.
   - Autenticação privada via Google Cloud IAP / OIDC e segredos injetados via **Google Secret Manager**.
4. **Infraestrutura como Código com Terraform (`infra/`):**
   - Provisionamento declarativo de Cloud Run, Artifact Registry, Secret Manager, Service Accounts com menor privilégio (IAM) e budgets/alertas de faturamento.
5. **Observabilidade Padrão de Mercado com OpenTelemetry (OTel):**
   - Instrumentação nativa com OpenTelemetry SDK em Go exportando traces distribuídos (`extract`, `drive.read`, `gemini.generate`, `docs.patch`, `backlog.save`), métricas (histogramas P50/P95/P99, contadores de tokens e códigos de erro) e logs correlacionados (`trace_id`, `span_id`) para Google Cloud Trace / Cloud Monitoring / Grafana Cloud.
