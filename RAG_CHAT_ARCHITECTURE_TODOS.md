# RAG Chat Architecture TODOs

This file tracks follow-up architecture work for the RAG chat beyond the functional fixes already implemented.

## Highest Priority

### 1. Isolate conversation history per user or chat session

- Current issue: `services/ragService.js` stores `conversationHistory` on the singleton service instance.
- Risk: different users, browser tabs, or concurrent chats can leak context into each other.
- Goal: move history ownership to a user session or explicit chat identifier.
- Suggested direction:
  - pass history into `rewriteQuery()` and `askQuestion()` explicitly
  - stop mutating process-global history inside `RagService`
  - scope history clear/read operations to the active chat only

### 2. Split retrieval and generation into clearer pipeline steps

- Current issue: `askQuestion()` handles rewrite, filter resolution, retrieval, document expansion, prompt building, answer generation, and history mutation in one flow.
- Risk: hard to test, reason about, and evolve safely.
- Goal: separate the RAG flow into distinct, mostly pure steps.
- Suggested direction:
  - `rewriteQuestion()`
  - `resolveFilters()`
  - `retrieveContext()`
  - `expandOrTrimContext()`
  - `generateAnswer()`

### 3. Fix or remove the dead `useAI` path

- Current issue: the frontend sends `useAI`, but the backend does not use it.
- Risk: UI suggests a capability that does not actually exist.
- Goal: either implement a true retrieval-only mode or remove the toggle from the RAG chat UI.

## Important Next

### 4. Replace prompt stuffing with a real context budget strategy

- Current issue: the service fetches full document contents and appends them into the prompt until a rough character limit is hit.
- Risk: expensive requests, low signal-to-noise, and brittle truncation.
- Goal: make context assembly deliberate and token-aware.
- Suggested direction:
  - rank chunks instead of appending whole documents blindly
  - cap how much each source can contribute
  - use token-aware truncation rather than character-count heuristics

### 5. Define a single shared filter schema

- Current issue: filter handling is limited to a small ad hoc set of fields.
- Risk: future filter additions can drift between UI, route handling, rewrite extraction, and backend retrieval.
- Goal: establish one shared filter contract for the full RAG path.
- Suggested direction:
  - define the allowed filter fields centrally
  - validate and normalize them once at the API boundary
  - reuse the same shape in rewrite output and retrieval requests

### 6. Add validation for `/api/rag/ask`

- Current issue: request data is passed through with minimal validation.
- Risk: invalid dates, malformed filters, and inconsistent empty values reach the service layer.
- Goal: reject bad requests early and normalize accepted ones consistently.
- Suggested direction:
  - validate `question`
  - validate date formats and ranges
  - normalize empty strings to `undefined`
  - enforce the shared filter schema

## Quality And Reliability

### 7. Add integration-style coverage for the answer path

- Current issue: rewrite parsing has regression coverage, but the full answer pipeline still lacks targeted tests.
- Goal: protect the main RAG chat contract against regressions.
- Suggested scenarios:
  - UI filters override extracted filters when both are present
  - follow-up questions use the correct scoped history
  - reasoning is returned separately from the visible answer
  - citations only reference sources that were actually provided

### 8. Add lightweight observability around the RAG flow

- Current issue: debugging relies mostly on ad hoc console output.
- Goal: make failures and regressions easier to diagnose without temporary instrumentation.
- Suggested signals:
  - rewrite result
  - effective filters
  - retrieved source count
  - expanded context size
  - provider and model used for final answer generation

### 9. Move or gate debug endpoints outside the normal production surface

- Current issue: test and history endpoints live in the main authenticated RAG router.
- Risk: unnecessary production surface area and confusion about supported API behavior.
- Goal: keep debug tools available without treating them as part of the stable production API.
- Suggested direction:
  - gate behind an environment flag
  - move to a dedicated debug router
  - remove entirely if no longer needed

## Suggested Order

1. Isolate conversation history per user or chat session.
2. Split the RAG pipeline into clearer units.
3. Fix or remove the dead `useAI` path.
4. Introduce a shared filter schema and route validation.
5. Improve context budgeting.
6. Add answer-path tests and observability.
7. Move or gate debug endpoints.
