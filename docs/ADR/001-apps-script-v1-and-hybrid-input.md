# ADR 001: Google Apps Script V8 na v1, Edição ATS In-Place e Entrada Híbrida Anti-Bot

- **Status:** Aceito
- **Data:** 2026-11-26
- **Contexto:** Fase 1 do TailorOps (`tailor-ops`)

---

## Contexto e Problema

O processo manual de adaptar currículos ATS vaga a vaga e registrar insumos para entrevistas apresenta quatro gargalos principais:
1. **Sincronização de contexto:** o histórico completo do candidato (`Master Database`) e o modelo visual (`Currículo ATS Base — Luan Magno`) evoluem continuamente no Google Docs e não podem ficar congelados em código.
2. **Fidelidade estrita de formatação ATS:** geradores baseados em HTML/PDF ou Markdown frequentemente quebram margens, fontes, bordas inferiores de seção ou ultrapassam 1 página.
3. **Bloqueios anti-bot em portais de vagas:** LinkedIn, Indeed, Glassdoor e Catho bloqueiam scraping autenticado, exigindo CAPTCHAs ou sessões de navegador que não devem ser contornadas por automação abusiva.
4. **Uso móvel e custo operacional zero:** o sistema é de uso individual/privado (`MYSELF`), acionado tanto no desktop quanto no celular, sem justificativa para manter infraestrutura paga ligada 24/7 na v1.

---

## Decisões Arquiteturais

### 1. Runtime v1 em Google Apps Script V8 (`USER_DEPLOYING` + `MYSELF`)
- **Decisão:** Hospedar o Web App privado e o backend RPC diretamente no Google Apps Script V8 versionado via `clasp` + Git + GitHub Actions.
- **Motivação:** Autenticação Google nativa restrita à própria conta (`access: "MYSELF"`), custo zero de hospedagem e acesso transacional nativo ao `DriveApp`, `DocumentApp` e `SpreadsheetApp` sem necessidade de gerenciar fluxos OAuth externos ou banco de dados dedicado na Fase 1.

### 2. Clonagem + Edição Cirúrgica *In-Place* no Google Docs
- **Decisão:** Nunca construir o currículo do zero. Clonar o arquivo `Currículo ATS Base — Luan Magno` na pasta de saída e substituir apenas o conteúdo interno das 5 seções âncora de baixo para cima, preservando atributos do parágrafo/lista e aplicando negrito apenas até `:` nas linhas de habilidades.
- **Motivação:** Garante preservação exata do template aprovado para ATS (coluna única, bordas, espaçamento, fonte 10–10.5pt) e exportação imediata via link nativo `.../export?format=pdf`.

### 3. Arquitetura de Entrada Híbrida em 4 Modos (Respeitando Anti-Bot)
- **Decisão:** Suportar quatro canais complementares de captura:
  1. **Bookmarklet de 1 clique no PC (`TAILOROPS_CAPTURE::`)**: lê o DOM já renderizado pelo próprio usuário na aba aberta e envia para a área de transferência.
  2. **Upload de até 4 prints no celular**: comprimidos no cliente via `<canvas>` (máx. 1400px, JPEG 0.82) e interpretados via Gemini Multimodal (`inlineData`).
  3. **Texto colado manualmente**.
  4. **Tentativa única leve por URL (`r.jina.ai`)**: sem retries agressivos nem tentativa de burlar proteções; em bloqueio ou retorno `< 300` caracteres úteis, devolve `NEEDS_MANUAL_TEXT` orientando fallback imediato na UI.

### 4. Isolamento da Lógica Pura (`src/PureLogic.gs`) e Contrato de Observabilidade
- **Decisão:** Concentrar validações de schema JSON, sanitização de nomes, cálculo de backoff/jitter, parser do bookmarklet e serialização das 14 colunas do Backlog em `src/PureLogic.gs` com exportação condicional CommonJS para testes rápidos em Vitest. Isolar `ObservabilityService.gs` por contrato explícito para implementação manual SRE.

---

## Consequências e Trade-offs

### Positivas
- Custo operacional de infraestrutura igual a zero (apenas consumo da API Gemini sob demanda).
- Testes unitários locais executam em milissegundos via Node/Vitest, incluindo validação do escopo global V8 do Apps Script (`tests/gasRuntime.test.js`).
- Portabilidade direta dos contratos JSON e regras de domínio para a Fase 2 em Go + Cloud Run.

### Limitações Aceitas na Fase 1
- Limite de tempo de execução síncrona do Apps Script (~6 min por chamada) e limite de payload do `google.script.run` (mitigado pela compressão `<canvas>` no cliente e limite de 4 imagens).
- Ausência de medição exata de páginas renderizadas na API `DocumentApp` (mitigada por heurística de razão de caracteres/parágrafos `assessOnePageRisk` + alerta de revisão na UI).
