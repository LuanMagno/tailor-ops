# TailorOps (`tailor-ops`)

Web App privado mobile-first construído sobre **Google Apps Script (`clasp` + Git)** integrado ao **Google Drive**, **Google Docs**, **Google Sheets** e **Google Gemini API** para automatizar a adaptação de currículos ATS sob medida e manter um backlog rastreável de candidaturas para preparação de entrevistas.

---

## Arquitetura (Fase 1)

```text
[PC: Bookmarklet 1-clique] ──(clipboard)──┐
[Celular: Prints da vaga]  ──(upload)─────┼──► [Web App Privado: src/index.html]
[Texto / URL aberta]       ──(input)──────┘            │ (google.script.run - Auth Google "MYSELF")
                                                       ▼
                                              [Controller: src/Code.gs]
                                                ├── Config.gs (ScriptProperties validadas)
                                                ├── PureLogic.gs (regras puras compartilhadas GAS + Vitest)
                                                ├── ObservabilityService.gs (STUB -> implementação manual SRE)
                                                ├── InputExtractorService.gs (bookmarklet / multimodal / texto / r.jina.ai)
                                                ├── DriveDocsService.gs (leitura ao vivo + clone + edição in-place)
                                                ├── GeminiService.gs (REST API + responseSchema + backoff/jitter)
                                                └── BacklogRepo.gs (CRUD Sheets: aba Backlog A..N)
```

### Princípios Principais
1. **Leitura ao vivo do Drive (Zero hardcode):** A cada execução, `Master Database` e `Currículo ATS Base — Luan Magno` são lidos ao vivo do Google Docs.
2. **Wizard em 2 passos com Pausa Obrigatória (Etapa 3):** Análise de 15 keywords e diagnóstico de lacunas com validação explícita antes da geração da Etapa 4.
3. **Preservação cirúrgica do layout ATS:** Clonagem do documento base em `Carreira / Curriculo` (`CV- Luan Magno - {Empresa} - {Cargo}`) e edição *in-place* mantendo margens, fonte, bordas inferiores, listas, negrito até `:` em habilidades e 1 página.
4. **Captura híbrida anti-bot:** Bookmarklet (`TAILOROPS_CAPTURE::`), até 4 prints comprimidos via `<canvas>` (máx. 1400px, JPEG 0.82), texto colado manualmente ou 1 tentativa leve via `r.jina.ai`.
5. **Divisão DevOps/SRE (IA vs. Humano):** CI/CD, idempotência, backoff/jitter e core entregues prontos; tracing, structured logging, escrita na aba `Telemetry`, cálculo de SLIs e `docs/RUNBOOK.md` isolados como contratos/stubs para implementação manual.

---

## Desenvolvimento Local

Pré-requisitos: **Node.js >= 24** e **npm**.

```bash
npm install
npm run lint   # ESLint sobre src/**/*.gs, tests/**/*.js e eslint.config.js
npm test       # Vitest (testes unitários de PureLogic + compatibilidade V8 GAS)
```

---

## Setup e Deploy no Google Apps Script

### 1. Habilitar API e vincular projeto `clasp`
1. Ative a **Google Apps Script API** em `https://script.google.com/home/usersettings`.
2. Faça login e crie o projeto standalone apontando para `./src`:
   ```bash
   npx clasp login
   npx clasp create --type standalone --title "TailorOps" --rootDir ./src
   ```
   *(O arquivo `.clasp.json` gerado já está protegido no `.gitignore`.)*

### 2. Configurar `ScriptProperties`
Rode `npx clasp push --force` e `npx clasp open`. Em **Configurações do projeto → Propriedades do script**, cadastre as 7 propriedades obrigatórias:

| Propriedade | Descrição |
| :--- | :--- |
| `GEMINI_API_KEY` | Chave da API Gemini (Google AI Studio) |
| `MASTER_DB_DOC_ID` | ID do Google Doc `Master Database` |
| `BASE_RESUME_DOC_ID` | ID do Google Doc `Currículo ATS Base — Luan Magno` |
| `OUTPUT_FOLDER_ID` | ID da pasta `Carreira / Curriculo` no Google Drive |
| `BACKLOG_SHEET_ID` | ID da planilha `Backlog de Vagas — Luan Magno` |
| `MODEL_HIGH` | Modelo Gemini de maior raciocínio (padrão na UI) |
| `MODEL_FAST` | Modelo Gemini Flash para execuções rápidas |

### 3. Executar `testHealthCheck()` e publicar
1. No editor do Apps Script, selecione a função `testHealthCheck` em `Code.gs` e clique em **Executar** para autorizar os escopos OAuth e validar acesso somente-leitura aos 2 Docs, pasta e abas `Backlog`/`Telemetry`.
2. Gere o primeiro deployment fixo:
   ```bash
   npx clasp deploy -d "v1.0.0"
   ```
3. Configure os **GitHub Actions Secrets** (`CLASPRC_JSON`, `SCRIPT_ID`, `DEPLOYMENT_ID`) para habilitar o CD automático a cada push na `main`.

---

## Documentação Adicional
- Especificação técnica completa: [`TailorOps_SPECS.md`](./TailorOps_SPECS.md)
- Decisão arquitetural v1: [`docs/ADR/001-apps-script-v1-and-hybrid-input.md`](./docs/ADR/001-apps-script-v1-and-hybrid-input.md)
- Evolução Fase 2 (Go + Cloud Run + Terraform + OTel): [`docs/ROADMAP.md`](./docs/ROADMAP.md)
- Runbook operacional (template SRE): [`docs/RUNBOOK.md`](./docs/RUNBOOK.md)
