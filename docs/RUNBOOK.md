# Runbook Operacional — TailorOps (Template SRE)

> **NOTA:** Este arquivo é um **template estrutural** conforme a Seção 6.1 da especificação. Preencha manualmente os limiares de SLI/SLO, consultas de diagnóstico e procedimentos de mitigação após implementar `ObservabilityService.gs` e `computeSliSummary`.

---

## 1. Visão Geral do Serviço e Dependências Críticas

- **Serviço:** TailorOps Web App (Google Apps Script V8)
- **Proprietário / On-Call:** `TODO(observability): definir responsável`
- **Dependências Externas:**
  - `TODO(observability): mapear criticidade e limites de cota da Google Gemini API`
  - `TODO(observability): mapear dependências de Google Drive API / Google Docs API`
  - `TODO(observability): mapear planilha Google Sheets (abas Backlog e Telemetry)`
  - `TODO(observability): mapear proxy leve de extração (r.jina.ai)`

---

## 2. SLIs, SLOs e Error Budget

| Indicador (SLI) | Fonte de Dados | Meta (SLO) | Janela |
| :--- | :--- | :--- | :--- |
| Disponibilidade / Taxa de Sucesso (`successRate`) | `TODO(observability)` | `TODO` | `TODO` |
| Latência Ponta a Ponta P95 (`latency.p95Ms`) | `TODO(observability)` | `TODO` | `TODO` |
| Taxa de Fallback de Extração (`fallbackRate`) | `TODO(observability)` | `TODO` | `TODO` |
| Integridade de Schema Gemini (`SCHEMA_INVALID`) | `TODO(observability)` | `TODO` | `TODO` |

- **Política de Error Budget:** `TODO(observability): descrever quando congelar mudanças de prompt/modelo e priorizar confiabilidade.`

---

## 3. Diagnóstico Rápido (Triage Checklist)

1. `TODO(observability): verificar últimas execuções e trace_id na aba Telemetry`
2. `TODO(observability): consultar logs estruturados no Cloud Logging / Apps Script Executions`
3. `TODO(observability): executar testHealthCheck() no editor do Apps Script e validar retorno`

---

## 4. Playbooks por Código de Erro

### 4.1. `GEMINI_429` / Exaustão de Cota ou Rate Limit
- **Sintomas:** `TODO(observability)`
- **Verificação:** `TODO(observability)`
- **Mitigação (ex.: alternância para `MODEL_FAST`):** `TODO(observability)`

### 4.2. `GEMINI_500` / `GEMINI_503` / Instabilidade Upstream
- **Sintomas:** `TODO(observability)`
- **Verificação:** `TODO(observability)`
- **Mitigação:** `TODO(observability)`

### 4.3. `SCHEMA_INVALID` / `GEMINI_MAX_TOKENS`
- **Sintomas:** `TODO(observability)`
- **Verificação:** `TODO(observability)`
- **Mitigação:** `TODO(observability)`

### 4.4. `NEEDS_MANUAL_TEXT` Elevado (Degradação em `url_fetch`)
- **Sintomas:** `TODO(observability)`
- **Verificação:** `TODO(observability)`
- **Mitigação:** `TODO(observability)`

### 4.5. `CONFIG_MISSING` / `BASE_TEMPLATE_INVALID` / Permissão Drive & Sheets
- **Sintomas:** `TODO(observability)`
- **Verificação:** `TODO(observability)`
- **Mitigação:** `TODO(observability)`

---

## 5. Procedimento de Rollback de Deploy

- **Via GitHub Actions / Clasp:**
  - `TODO(observability): documentar comando exato de listagem de versões (npx clasp versions) e rollback do DEPLOYMENT_ID fixo (npx clasp deploy -i <DEPLOYMENT_ID> -V <VERSAO_ESTAVEL>).`

---

## 6. Template de Post-Mortem (Sem Culpa / Blameless)

- **Data e Duração:** `TODO`
- **Impacto nos SLOs:** `TODO`
- **Trace IDs Afetados:** `TODO`
- **Causa Raiz (5 Porquês):** `TODO`
- **Ações Preventivas:** `TODO`
