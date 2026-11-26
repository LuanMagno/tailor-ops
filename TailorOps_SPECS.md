# TailorOps — Especificação Técnica e Guia de Implementação (`SPEC.md`)

## 1. Visão Geral do Projeto

**Nome:** TailorOps (`tailor-ops`)  
**Objetivo:** Web App privado mobile-first construído sobre **Google Apps Script (`clasp` + Git)** integrado ao **Google Drive**, **Google Docs**, **Google Sheets** e **Google Gemini API** para automatizar a geração de currículos ATS sob medida e manter um backlog rastreável de candidaturas para preparação de entrevistas.

### Princípios Inegociáveis
1. **Leitura ao vivo do Drive (Zero hardcode de conteúdo):** A cada execução, o backend lê a versão atual dos dois Google Docs do usuário no Drive (`Master Database` e `Currículo ATS Base — Luan Magno`). Qualquer atualização futura nos documentos (ex.: novos projetos de portfólio) passa a valer automaticamente sem alteração de código.
2. **Fidelidade total ao fluxo de 4 etapas da `Master Database`:** O app implementa obrigatoriamente um **Wizard de 2 passos** para respeitar a **Pausa Obrigatória da Etapa 3** (validação de lacunas e tecnologias pelo candidato antes da geração do currículo).
3. **Preservação cirúrgica do layout ATS:** Nunca gerar um documento do zero. Sempre duplicar o arquivo `Currículo ATS Base — Luan Magno`, salvar na pasta `Carreira / Curriculo` e editar os textos *in-place* preservando margens, fonte (10–10.5pt), coluna única, bordas inferiores, negritos nos rótulos e extensão rigorosa de **1 página**.
4. **Entrada à prova de anti-bot (Indeed, Glassdoor, Catho, LinkedIn):** Arquitetura híbrida combinando **Bookmarklet de 1 clique no PC**, **Upload de prints no celular (Gemini Multimodal)**, **texto manual** e **1 tentativa leve de fetch por URL** (`r.jina.ai`).
5. **Engenharia DevOps/SRE com divisão IA vs. Humano:** O agente implementa CI/CD, resiliência e o core completo; a lógica interna de **Observabilidade (tracing, structured logging, SLIs e Runbook)** fica isolada por contratos/stubs para implementação manual posterior pelo desenvolvedor.

---

## 2. Bootstrap: Criando o Repositório no GitHub e Vinculando ao Apps Script

Execute estes passos no terminal antes de rodar o primeiro `clasp push`:

### 2.1. Criar o repositório local e subir para o GitHub
```bash
# 1. Criar pasta do projeto e inicializar Git
mkdir tailor-ops
cd tailor-ops
git init -b main

# 2. Inicializar Node.js e instalar ferramentas de dev/CI
npm init -y
npm install -D @google/clasp vitest eslint

# 3. Criar repositório no GitHub (via GitHub CLI — use --public ou --private)
gh repo create tailor-ops --public --source=. --remote=origin --description "ATS Resume Tailoring & Application Backlog with SRE Observability on Google Apps Script + Gemini API"

# Alternativa sem GitHub CLI:
# Crie o repositório "tailor-ops" manualmente em [https://github.com/new](https://github.com/new) (vazio, sem README)
# e depois execute:
# git remote add origin [https://github.com/SEU_USUARIO/tailor-ops.git](https://github.com/SEU_USUARIO/tailor-ops.git)
```

### 2.2. Autenticar o `clasp` e criar o projeto Apps Script
1. Habilite a **Google Apps Script API** em `https://script.google.com/home/usersettings`.
2. Autentique e crie o projeto apontando para `./src`:
```bash
npx clasp login
mkdir src
npx clasp create --type standalone --title "TailorOps" --rootDir ./src
```
3. **Segurança crítica:** Confirme que `.clasp.json` está no `.gitignore` antes do primeiro commit (ele contém o `scriptId` da conta).

### 2.3. Configurar `ScriptProperties` (Segredos e IDs fora do Git)
Abra o editor do projeto com `npx clasp open`, vá em **Configurações do projeto → Propriedades do script** e cadastre estas 7 chaves:

| Propriedade | Onde obter o valor |
| :--- | :--- |
| `GEMINI_API_KEY` | Chave do Google AI Studio (`aistudio.google.com/apikey`) |
| `MASTER_DB_DOC_ID` | ID na URL do Google Doc `Master Database` (versão completa/favoritada) |
| `BASE_RESUME_DOC_ID` | ID na URL do Google Doc `Currículo ATS Base — Luan Magno` |
| `OUTPUT_FOLDER_ID` | ID na URL da pasta `Carreira / Curriculo` no Google Drive |
| `BACKLOG_SHEET_ID` | ID na URL da planilha `Backlog de Vagas — Luan Magno` em `Carreira` |
| `MODEL_HIGH` | Modelo de maior qualidade/raciocínio da API Gemini (padrão na UI) |
| `MODEL_FAST` | Modelo Flash da API Gemini para execuções rápidas / economia de cota |

> Nunca commitar chaves de API ou IDs reais do Drive no repositório Git.

### 2.4. Configurar GitHub Actions Secrets (CD automático)
1. Faça o primeiro deploy manual: `npx clasp push && npx clasp deploy -d "v1.0.0"` e anote o **Deployment ID** fixo retornado.
2. No GitHub, vá em **Settings → Secrets and variables → Actions** e adicione:
   - `CLASPRC_JSON`: conteúdo completo de `~/.clasprc.json`.
   - `SCRIPT_ID`: valor de `scriptId` do `.clasp.json`.
   - `DEPLOYMENT_ID`: Deployment ID fixo do passo 1.

---

## 3. Arquitetura do Sistema (Fase 1)

```text
[PC: Bookmarklet 1-clique] ──(clipboard)──┐
[Celular: Prints da vaga]  ──(upload)─────┼──► [Web App Privado: src/index.html]
[Texto / URL aberta]       ──(input)──────┘            │ (google.script.run - Auth Google "MYSELF")
                                                       ▼
                                              [Controller: src/Code.gs]
                                                ├── ObservabilityService.gs (STUB -> implementação manual)
                                                ├── InputExtractorService.gs (bookmarklet JSON / multimodal / URL leve)
                                                ├── DriveDocsService.gs (leitura ao vivo + clone + edição in-place)
                                                ├── GeminiService.gs (REST API + responseSchema + backoff/jitter)
                                                └── BacklogRepo.gs (CRUD Sheets: aba Backlog)
```

### Evolução Planejada (Fase 2 — Documentar em `docs/ROADMAP.md`, NÃO implementar na v1)
- Migração do motor para serviço containerizado em **Go** + **Docker** + **Google Cloud Run** + **Terraform** (IaC) + **OpenTelemetry**.
- Na Fase 1, manter contratos JSON limpos e lógica pura isolada em `src/PureLogic.gs`.

---

## 4. Requisitos Funcionais Detalhados

### 4.1. Fluxo Principal — Wizard em 2 Passos

#### Passo 1: Captura e Análise (`analyzeJob`)
1. **Entradas na UI:**
   - `jobUrl` *(obrigatório)*: Link da vaga (chave de correlação no backlog).
   - `modelTier` *(seletor na UI)*: `HIGH` (**Qualidade Máxima — selecionado por padrão**) ou `FAST` (**Rápido**).
   - **Modo de entrada híbrido:**
     - **A) Botão "Colar Captura (Bookmarklet)":** Lê payload `TAILOROPS_CAPTURE::` do clipboard e preenche `jobUrl` + `manualText`.
     - **B) Upload de Prints (Mobile):** Aceita até **4 imagens** (PNG/JPEG/WebP). Redimensionar/comprimir no front-end via `<canvas>` (largura máx. 1400px, JPEG ~0.82) antes de enviar em Base64 ao Apps Script.
     - **C) Texto colado manualmente** no textarea.
     - **D) Apenas URL (tentativa leve):** Se não houver texto nem imagens, o backend tenta **1 única vez** via `https://r.jina.ai/<URL>`. Se falhar (403/timeout/Cloudflare) ou retornar `< 300` caracteres úteis, retorna `code: 'NEEDS_MANUAL_TEXT'` e a UI orienta a colar o texto ou anexar prints mantendo a URL preenchida.
2. **Processamento Backend (`analyzeJob`):**
   - Lê ao vivo `Master Database` e `Currículo ATS Base — Luan Magno`.
   - Chama a API Gemini (texto ou `inlineData` das imagens) executando rigorosamente as **Etapas 1, 2 e 3** da `Master Database` com `responseSchema` estrito:
     - `company`, `role`, `language` (`"PT"` | `"EN"` — detectado automaticamente).
     - `keywords`: array com as **15 palavras-chave técnicas e competências** mais importantes da vaga, exatamente como escritas.
     - `gapAnalysis`: `{ hasPracticalContext: string[], underHighlighted: string[], realGaps: string[] }`.
     - `validationQuestions`: array de `{ id, technology, reason, question, suggestedDefault }` para a **Pausa Obrigatória da Etapa 3**.
     - `extractedJobSummary`: resumo textual limpo da vaga (repassado ao Passo 2 sem reenviar imagens).

#### Tela Intermediária: Pausa Obrigatória da Etapa 3
- Campos editáveis de **Empresa**, **Cargo** e seletor de **Idioma (`PT`/`EN`)**.
- Chips das 15 keywords e Diagnóstico de Aderência nos 3 blocos.
- Cards interativos para cada `validationQuestion` com toggle **Incluir / Não incluir** + campo opcional de contexto curto.
- Campo livre opcional: *"Instruções extras para esta versão"*.
- Botão principal: **Gerar Currículo ATS**.

#### Passo 2: Geração do Currículo e Backlog (`generateResume`)
1. **Chamada ao Gemini (Etapa 4):**
   - Envia: `Master Database` (ao vivo), `Currículo ATS Base — Luan Magno` (ao vivo), descrição/resumo da vaga, idioma alvo, análise e respostas da Etapa 3.
   - Respeita todas as regras da `Master Database`:
     - Zero alucinação (somente fatos da Master Database ou aprovados na Etapa 3).
     - Verbos de ação fortes no passado em todos os bullets (PT ou EN; nunca *"Responsável por..."*).
     - Resumo em 3 a 4 linhas direcionado à vaga.
     - Experiências principais: Fit Energia e dti digital (resgatar Monitoria / Projeto Beira Linha / futuros Projetos da Seção 5 apenas se diretamente relevantes e couberem em 1 página).
     - Habilidades Técnicas em 4 a 5 linhas com separador `|`, priorizando keywords no início, **nunca** escrevendo `(Em estudo)` ou `(em aprendizado)`.
     - Cursos Relevantes em 1 linha separados por `|`.
   - Retorna JSON estrito (`responseSchema`) com as seções reescritas + `highlightsSummary` (3–5 bullets do foco aplicado para entrevista) + `gapsSummary` (lacunas + decisões da Etapa 3).
2. **Clonagem e Edição *In-Place* no Google Docs (`DriveDocsService.gs`):**
   - Duplica `Currículo ATS Base — Luan Magno` dentro de `OUTPUT_FOLDER_ID` (`Carreira / Curriculo`).
   - Nomeia o arquivo exatamente como (sanitizando caracteres inválidos):
     ```text
     CV- Luan Magno - {Empresa} - {Cargo}
     ```
   - Edita *in-place* preservando estilos originais (margens, fonte 10–10.5pt, bordas inferiores, listas, coluna única, 1 página):
     - Localiza os blocos âncora (`RESUMO PROFISSIONAL`, `EXPERIÊNCIA PROFISSIONAL`, `HABILIDADES TÉCNICAS`, `FORMAÇÃO ACADÊMICA`, `CURSOS RELEVANTES`) e traduz os cabeçalhos para inglês quando `language === 'EN'` (`PROFESSIONAL SUMMARY`, `PROFESSIONAL EXPERIENCE`, `TECHNICAL SKILLS`, `EDUCATION`, `RELEVANT COURSEWORK`).
     - Atualiza Resumo, Experiências (mantendo formato de list items sem aplicar Heading padrão), linhas de Habilidades aplicando **negrito apenas de 0 até `:`** (`setBold(0, colonIdx, true)` e regular depois), Formação e Cursos.
     - Executa `doc.saveAndClose()`.
   - Retorna `docUrl` (`.../edit`) e `pdfUrl` (`.../export?format=pdf`).
3. **Gravação no Backlog (`BacklogRepo.gs`):**
   - Grava nova linha na aba `Backlog` com `status = "Gerado"` e ID único (`APP-YYYYMMDD-XXXX`).
4. **Tela de Conclusão (Mobile-First):**
   - Botões grandes: **Baixar PDF**, **Abrir no Google Docs**, **Copiar Destaques da Entrevista** e **Ir para o Backlog**.

---

### 4.2. Bookmarklet de 1 Clique (PC)
- A UI inclui um modal **"Configurar Bookmarklet (PC)"** com instruções e link arrastável para a barra de favoritos.
- Ao clicar em qualquer vaga aberta (Indeed, Glassdoor, Catho, LinkedIn):
  - Captura `window.location.href`, `document.title` e `window.getSelection().toString()` (ou `document.body.innerText` limpo, limitado a ~25.000 chars).
  - Copia `TAILOROPS_CAPTURE::` + JSON para o `navigator.clipboard` e exibe um toast discreto de confirmação.

---

### 4.3. Gestão de Backlog (`getBacklog`, `updateApplication`)
- **Status permitidos (exatos):** `Gerado`, `Aplicado`, `Em Andamento`, `Proposta`, `Rejeitado`, `Desisti`, `Empresa não retornou`.
- Busca instantânea por Empresa, Cargo ou Keyword + filtro por pills de Status com contadores.
- Cards com alteração rápida de status em 1 toque (persiste no Sheets), links (`Vaga`, `Docs`, `PDF`) e modal de **Preparação para Entrevista** (15 keywords, `highlights_summary`, `gaps_summary` e campo editável `notes`).

---

## 5. Modelo de Dados (Google Sheets — Já Criado)

Planilha: **`Backlog de Vagas — Luan Magno`** (na pasta `Carreira`).

### Aba 1: `Backlog` (Colunas `A` até `N`)
| Col | Cabeçalho | Tipo / Observação |
| :--- | :--- | :--- |
| A | `id` | String (`APP-YYYYMMDD-XXXX`) |
| B | `created_at` | ISO-8601 (`America/Sao_Paulo`) |
| C | `company` | String |
| D | `role` | String |
| E | `language` | `PT` \| `EN` |
| F | `status` | Um dos 7 status da Seção 4.3 |
| G | `job_url` | URL |
| H | `doc_url` | URL do Google Docs gerado |
| I | `pdf_url` | URL de exportação direta em PDF |
| J | `keywords_json` | JSON array (15 keywords) |
| K | `highlights_summary` | Destaques priorizados para entrevista |
| L | `gaps_summary` | Lacunas + itens confirmados na Etapa 3 |
| M | `notes` | Notas manuais de entrevista |
| N | `metadata_json` | JSON extensível para futuras features |

### Aba 2: `Telemetry` (Colunas `A` até `M`)
| Col | Cabeçalho | Tipo / Observação |
| :--- | :--- | :--- |
| A | `timestamp` | ISO-8601 |
| B | `trace_id` | UUID curto único por execução |
| C | `operation` | `analyzeJob` \| `generateResume` \| `getBacklog` \| `updateApplication` |
| D | `input_mode` | `bookmarklet` \| `screenshot` \| `manual_text` \| `url_fetch` \| `n/a` |
| E | `model_used` | Nome real do modelo usado na API |
| F | `status` | `OK` \| `FALLBACK` \| `ERROR` |
| G | `total_ms` | Latência total (ms) |
| H | `extract_ms` | Tempo de extração (ms) |
| I | `drive_ms` | Tempo de Drive/Docs (ms) |
| J | `gemini_ms` | Tempo da chamada Gemini (ms) |
| K | `tokens_in` | `usageMetadata.promptTokenCount` |
| L | `tokens_out` | `usageMetadata.candidatesTokenCount` |
| M | `error_code` | Código padronizado (`GEMINI_429`, `NEEDS_MANUAL_TEXT`, `SCHEMA_INVALID`, etc.) |

---

## 6. Requisitos de DevOps, SRE e Observabilidade (Divisão IA vs. Humano)

> **INSTRUÇÃO CRÍTICA PARA O AGENTE:** A implementação interna da camada de observabilidade (tracing, structured logging, escrita na aba `Telemetry`, cálculo de SLIs e `docs/RUNBOOK.md`) será feita **manualmente pelo desenvolvedor** como exercício prático de SRE. **NÃO implemente a lógica interna desses módulos.** Crie apenas os contratos, stubs no-op que mantenham o app funcionando, a UI da aba "Métricas" pronta para consumir o contrato e `test.todo(...)` no Vitest.

### 6.1. O que o Agente DEVE criar para Observabilidade (apenas contratos/stubs)
- **`src/ObservabilityService.gs` (stub no-op):** Declarar:
  - `createTrace(operation, inputMode)` retornando um objeto com métodos no-op documentados via JSDoc (`traceId`, `startSpan(name)`, `endSpan(name)`, `setModel(model)`, `addTokens(inCount, outCount)`, `setStatus(status, errorCode)`, `log(level, event, data)`, `flush()`).
  - `getTelemetryMetrics()` retornando um objeto vazio no contrato exato abaixo:
    ```json
    {
      "implemented": false,
      "totalRuns": 0,
      "successRate": 0,
      "fallbackRate": 0,
      "latency": { "avgMs": 0, "p95Ms": 0, "avgExtractMs": 0, "avgDriveMs": 0, "avgGeminiMs": 0 },
      "tokensByModel": {},
      "byInputMode": { "bookmarklet": 0, "screenshot": 0, "manual_text": 0, "url_fetch": 0 },
      "recentTraces": []
    }
    ```
- **Pontos de instrumentação marcados:** Em `Code.gs` e `GeminiService.gs`, inserir comentários curtos `// TODO(observability): iniciar/encerrar span X / registrar tokens / chamar trace.flush() no finally`.
- **Funções de SLI em `src/PureLogic.gs`:** Declarar apenas as assinaturas vazias `calculatePercentile(values, percentile)` e `computeSliSummary(rows)` com `// TODO(observability)` e criar `tests/observability.test.js` apenas com `test.todo(...)` descrevendo os cenários esperados.
- **Painel de SLIs na UI (`src/index.html` — Aba 3: "Métricas"):** Implementar a interface visual completa consumindo `getTelemetryMetrics()`. Quando `implemented === false`, exibir banner amigável *"Camada de observabilidade pendente de implementação"* acima dos cards zerados.
- **`docs/RUNBOOK.md`:** Criar apenas template com seções e `TODO` para preenchimento manual.

### 6.2. O que o Agente DEVE implementar completamente (Resiliência + CI/CD)
- **Resiliência:** Retry com *exponential backoff + jitter* em `GeminiService.gs` (até 3 tentativas para HTTP `429`, `500`, `502`, `503`, `504`), trava de idempotência com `CacheService` (60s) e validação estrita do JSON retornado pelo Gemini.
- **Testes Unitários (Core):** `src/PureLogic.gs` com exportação condicional (`if (typeof module !== 'undefined') module.exports = ...`) para rodar no Apps Script (V8) e no Vitest, coberto por testes reais em `tests/pureLogic.test.js` (sanitização do nome `CV- Luan Magno - Empresa - Cargo`, parser do `TAILOROPS_CAPTURE::`, validação de schema e cálculo de backoff).
- **CI/CD no GitHub Actions:**
  - `.github/workflows/ci.yml`: `checkout` → `setup-node` → `npm ci` → `npm run lint` → `npm test` em `push`/`pull_request` na `main`.
  - `.github/workflows/deploy.yml`: reconstrói `~/.clasprc.json` e `.clasp.json` via Secrets → `npx clasp push --force` → `npx clasp deploy -i "$DEPLOYMENT_ID" -d "Deploy ${{ github.sha }}"` em push na `main` (ou `workflow_dispatch`).
- **Documentação:** `README.md`, `docs/ADR/001-apps-script-v1-and-hybrid-input.md` e `docs/ROADMAP.md`.

---

## 7. Estrutura de Arquivos Esperada

```text
tailor-ops/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
├── docs/
│   ├── ADR/
│   │   └── 001-apps-script-v1-and-hybrid-input.md
│   ├── ROADMAP.md
│   └── RUNBOOK.md                 # Template com TODOs (preenchimento manual)
├── tests/
│   ├── pureLogic.test.js          # Testes reais do core (Vitest)
│   └── observability.test.js      # Apenas test.todo(...) (implementação manual)
├── src/
│   ├── appsscript.json            # Manifest V8, America/Sao_Paulo, access MYSELF, escopos OAuth
│   ├── Config.gs                  # Leitura validada de ScriptProperties + STATUS_LIST
│   ├── PureLogic.gs               # Lógica pura (core implementado + assinaturas SLI em TODO)
│   ├── ObservabilityService.gs    # Stub no-op documentado (implementação manual)
│   ├── InputExtractorService.gs   # Bookmarklet parser, validação Base64, fallback r.jina.ai
│   ├── DriveDocsService.gs        # Leitura ao vivo dos 2 Docs + clone + edição in-place
│   ├── GeminiService.gs           # Gemini API (analyze + generate) + responseSchema + backoff
│   ├── BacklogRepo.gs             # CRUD aba Backlog
│   ├── Code.gs                    # doGet() + endpoints RPC públicos
│   └── index.html                 # SPA mobile-first (Nova Vaga, Backlog, Métricas, Bookmarklet)
├── .clasp.json.example
├── .gitignore                     # .clasp.json, node_modules/, .env, coverage/
├── eslint.config.js
├── package.json
├── README.md
└── SPEC.md
```

---

## 8. Manifest e Escopos (`src/appsscript.json`)

```json
{
  "timeZone": "America/Sao_Paulo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "MYSELF"
  },
  "oauthScopes": [
    "[https://www.googleapis.com/auth/spreadsheets](https://www.googleapis.com/auth/spreadsheets)",
    "[https://www.googleapis.com/auth/documents](https://www.googleapis.com/auth/documents)",
    "[https://www.googleapis.com/auth/drive](https://www.googleapis.com/auth/drive)",
    "[https://www.googleapis.com/auth/script.external_request](https://www.googleapis.com/auth/script.external_request)"
  ]
}
```

---

## 9. Critérios de Aceite (Definition of Done — Entrega do Agente)

- [ ] `npm test` e `npm run lint` executam limpos localmente e no GitHub Actions.
- [ ] `analyzeJob` funciona nos 4 modos de entrada (Bookmarklet, Prints comprimidos, Texto Manual e URL leve com fallback `NEEDS_MANUAL_TEXT`).
- [ ] `analyzeJob` lê ao vivo `Master Database` e `Currículo ATS Base — Luan Magno` e respeita a Pausa Obrigatória da Etapa 3.
- [ ] `generateResume` cria o arquivo em `Carreira / Curriculo` exatamente como `CV- Luan Magno - {Empresa} - {Cargo}`, preservando formatação ATS (1 página, coluna única, negrito até `:`, separador `|`, tradução de títulos em EN).
- [ ] Link direto de download em PDF (`export?format=pdf`) funciona no celular.
- [ ] Nova linha é gravada na aba `Backlog` com status `Gerado`, e status/`notes` podem ser atualizados pela UI.
- [ ] `ObservabilityService.gs`, funções de SLI em `PureLogic.gs`, `tests/observability.test.js` e `docs/RUNBOOK.md` foram deixados estritamente como contratos/stubs/TODOs para implementação manual.
- [ ] Nenhum segredo, API key ou ID real do Google Drive existe no repositório Git.