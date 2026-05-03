// services/ragService.js
const axios = require('axios');
const config = require('../config/config');
const AIServiceFactory = require('./aiServiceFactory');
const paperlessService = require('./paperlessService');
const promptTemplateService = require('./promptTemplateService');
const { extractJsonPayload } = require('./serviceUtils');

const DEFAULT_TIMEOUT = 30000;

function extractFallbackFilters(query) {
  const text = String(query || '').trim();
  if (!text) {
    return {};
  }

  const today = new Date();
  const formatDate = (date) => date.toISOString().split('T')[0];
  const filters = {};
  const normalized = text.toLowerCase();

  if (normalized.includes('last month')) {
    const fromDate = new Date(today);
    fromDate.setMonth(fromDate.getMonth() - 1);
    filters.from_date = formatDate(fromDate);
    filters.to_date = formatDate(today);
  } else if (normalized.includes('last week')) {
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 7);
    filters.from_date = formatDate(fromDate);
    filters.to_date = formatDate(today);
  } else if (normalized.includes('today')) {
    filters.from_date = formatDate(today);
    filters.to_date = formatDate(today);
  } else if (normalized.includes('this year')) {
    const fromDate = new Date(today.getFullYear(), 0, 1);
    filters.from_date = formatDate(fromDate);
    filters.to_date = formatDate(today);
  }

  return filters;
}

function mergeFilters(extractedFilters = {}, explicitFilters = {}) {
  return {
    from_date: explicitFilters.from_date || extractedFilters.from_date || undefined,
    to_date: explicitFilters.to_date || extractedFilters.to_date || undefined,
    correspondent: explicitFilters.correspondent || extractedFilters.correspondent || undefined
  };
}

function detectLanguageHint(text) {
  const value = String(text || '').trim();
  if (!value) {
    return 'en';
  }

  if (/[äöüß]/i.test(value) || /\b(rechnung|bezahlt|zahlung|welche|dokumente|offen|betrag|korrespondent)\b/i.test(value)) {
    return 'de';
  }

  return 'en';
}

function safeJsonParse(rawValue, fallback = null) {
  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return fallback;
  }
}

function truncateForDebug(value, maxLen = 6000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) {
    return '';
  }

  return text.length > maxLen ? `${text.slice(0, maxLen)}\n...[truncated]` : text;
}

function looksLikeGarbageAnswer(text) {
  const value = String(text || '').trim();
  if (!value) {
    return true;
  }

  const tokenCount = value.split(/\s+/).filter(Boolean).length;
  const uniqueTokens = new Set(value.toLowerCase().split(/\s+/).filter(Boolean));
  const alphaCount = (value.match(/[a-zA-ZäöüÄÖÜß]/g) || []).length;
  const digitCount = (value.match(/\d/g) || []).length;
  const repeatedHyphenPattern = /(\b[\w-]+-\s*){4,}/i.test(value);

  if (repeatedHyphenPattern) {
    return true;
  }

  if (tokenCount >= 6 && uniqueTokens.size <= Math.max(2, Math.floor(tokenCount / 4))) {
    return true;
  }

  if (alphaCount > 0 && digitCount > alphaCount * 2) {
    return true;
  }

  return false;
}

function normalizeQuestionText(text) {
  return String(text || '').trim().toLowerCase();
}

function hasAnyToken(text, patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

class RagService {
  constructor() {
    this.baseUrl = process.env.RAG_SERVICE_URL || 'http://localhost:8000';
    this.client = axios.create({ timeout: DEFAULT_TIMEOUT });
    this.aiStatusCache = null;
    this.aiStatusCacheTs = 0;
    this.aiStatusTtlMs = Number(process.env.RAG_AI_STATUS_TTL_MS || 300000);
    this.chatState = new Map();
    this.maxHistoryTurns = 5;
    this.maxDebugTraceEntries = 12;
    this.maxEscalationDocuments = Number(process.env.RAG_MAX_ESCALATION_DOCS || 2);
    this.maxRetrievalSources = Number(process.env.RAG_MAX_RETRIEVAL_SOURCES || 8);
    this.maxSourcesPerQuery = Number(process.env.RAG_MAX_SOURCES_PER_QUERY || 5);
    this.documentContentCache = new Map();
    this.maxChatStates = Number(process.env.RAG_MAX_CHAT_STATES || 200);
    this.chatStateTtlMs = Number(process.env.RAG_CHAT_STATE_TTL_MS || 3600000); // 1 hour default
    this.maxDocumentCacheEntries = Number(process.env.RAG_MAX_DOC_CACHE_ENTRIES || 500);
    setInterval(() => this._evictStaleChatStates(), 300000); // cleanup every 5 minutes
  }

  _evictStaleChatStates() {
    const now = Date.now();
    const ttl = this.chatStateTtlMs;
    for (const [chatId, state] of this.chatState) {
      if (now - (state.lastUpdatedAt || 0) > ttl) {
        this.chatState.delete(chatId);
      }
    }
    // If still over max size, evict oldest entries
    if (this.chatState.size > this.maxChatStates) {
      const sorted = [...this.chatState.entries()].sort(
        (a, b) => (a[1].lastUpdatedAt || 0) - (b[1].lastUpdatedAt || 0)
      );
      const toDelete = sorted.slice(0, this.chatState.size - this.maxChatStates);
      for (const [chatId] of toDelete) {
        this.chatState.delete(chatId);
      }
    }
    // Evict document content cache if over limit (LRU not tracked, remove arbitrary entries)
    if (this.documentContentCache.size > this.maxDocumentCacheEntries) {
      const keysToDelete = [...this.documentContentCache.keys()].slice(
        0, this.documentContentCache.size - this.maxDocumentCacheEntries
      );
      for (const key of keysToDelete) {
        this.documentContentCache.delete(key);
      }
    }
  }

  async _getClient() {
    return this.client;
  }

  ensureChatState(chatId = 'default') {
    if (!this.chatState.has(chatId)) {
      this.chatState.set(chatId, {
        history: [],
        debugTrace: [],
        activeResultSet: null,
        lastUpdatedAt: Date.now()
      });
    }

    const state = this.chatState.get(chatId);
    state.lastUpdatedAt = Date.now();
    return state;
  }

  get conversationHistory() {
    return this.getHistory('default');
  }

  set conversationHistory(value) {
    const state = this.ensureChatState('default');
    state.history = Array.isArray(value) ? value : [];
  }

  get maxHistoryMessages() {
    return this.maxHistoryTurns;
  }

  getHistory(chatId = 'default') {
    return this.ensureChatState(chatId).history;
  }

  getDebugTrace(chatId = 'default') {
    return this.ensureChatState(chatId).debugTrace;
  }

  getActiveResultSet(chatId = 'default') {
    return this.ensureChatState(chatId).activeResultSet;
  }

  setActiveResultSet(chatId = 'default', activeResultSet = null) {
    const state = this.ensureChatState(chatId);
    state.activeResultSet = activeResultSet;
    state.lastUpdatedAt = Date.now();
  }

  setDebugTrace(chatId = 'default', trace = []) {
    const state = this.ensureChatState(chatId);
    state.debugTrace = Array.isArray(trace) ? trace.slice(-this.maxDebugTraceEntries) : [];
    state.lastUpdatedAt = Date.now();
  }

  appendDebugTrace(chatId = 'default', entry = {}) {
    const state = this.ensureChatState(chatId);
    state.debugTrace.push({
      timestamp: new Date().toISOString(),
      ...entry
    });
    if (state.debugTrace.length > this.maxDebugTraceEntries) {
      state.debugTrace = state.debugTrace.slice(-this.maxDebugTraceEntries);
    }
    state.lastUpdatedAt = Date.now();
  }

  buildTurnScopedHistory(history = []) {
    const turns = [];
    let currentTurn = null;

    for (const message of history) {
      if (message.role === 'user') {
        currentTurn = { user: message, assistant: null };
        turns.push(currentTurn);
      } else if (currentTurn && !currentTurn.assistant) {
        currentTurn.assistant = message;
      } else {
        turns.push({ user: null, assistant: message });
        currentTurn = null;
      }
    }

    return turns.slice(-this.maxHistoryTurns).flatMap((turn) => [turn.user, turn.assistant].filter(Boolean));
  }

  normalizeSource(source = {}, index) {
    return {
      index: index + 1,
      title: source.title || `Document ${source.doc_id || index + 1}`,
      correspondent: source.correspondent || '',
      date: source.date || '',
      tags: source.tags || '',
      snippet: source.snippet || '',
      doc_id: source.doc_id,
      last_updated: source.last_updated || '',
      document_url: source.document_url || ''
    };
  }

  buildLightweightSources(sources = []) {
    return sources.map((source, index) => this.normalizeSource(source, index));
  }

  dedupeSources(sources = []) {
    const seen = new Set();
    const deduped = [];

    for (const source of sources) {
      const key = source.doc_id
        ? `doc:${source.doc_id}`
        : `meta:${source.title || ''}|${source.date || ''}|${source.correspondent || ''}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      deduped.push(source);
    }

    return deduped;
  }

  async retrieveSourcesForQueries(client, queries = [], filters = {}) {
    const normalizedQueries = Array.from(new Set(
      (Array.isArray(queries) ? queries : [])
        .map((query) => String(query || '').trim())
        .filter(Boolean)
    ));

    const retrievalQueries = normalizedQueries.length > 0 ? normalizedQueries : [filters.originalQuestion || ''];
    const allSources = [];
    const perQueryStats = [];

    for (const query of retrievalQueries) {
      const response = await client.post(`${this.baseUrl}/context`, {
        question: query,
        max_sources: this.maxSourcesPerQuery,
        from_date: filters.from_date,
        to_date: filters.to_date,
        correspondent: filters.correspondent
      });

      const querySources = this.buildLightweightSources(response.data.sources || []).map((source) => ({
        ...source,
        retrieved_query: query
      }));

      allSources.push(...querySources);
      perQueryStats.push({ query, source_count: querySources.length });
    }

    const merged = this.dedupeSources(allSources).slice(0, this.maxRetrievalSources);
    return {
      retrievalQueries,
      sources: merged,
      perQueryStats
    };
  }

  shouldForceEscalation(question, plannerResult = {}) {
    const normalized = String(question || '').toLowerCase();
    if (plannerResult.needs_deeper_evidence) {
      return true;
    }

    return [
      'exact',
      'genau',
      'quote',
      'clause',
      'klausel',
      'betrag',
      'amount',
      'why',
      'warum',
      'compare',
      'vergleich',
      'paid',
      'bezahlt',
      'overdue',
      'fällig'
    ].some((token) => normalized.includes(token));
  }

  hasMixedPaymentSignals(sources = []) {
    const paidSignals = sources.some((source) => /\bpaid\b/i.test(source.tags || ''));
    const unpaidSignals = sources.some((source) => !/\bpaid\b/i.test(source.tags || ''));
    return paidSignals && unpaidSignals;
  }

  inferEscalationIndexes(question, sources = []) {
    const normalized = String(question || '').toLowerCase();
    const asksForPaymentAggregation = /(still have to pay|remaining|left to pay|unpaid|offen|noch zahlen|sum|total|gesamt|bezahlen)/i.test(normalized);

    if (!asksForPaymentAggregation) {
      return [];
    }

    const preferred = sources
      .map((source) => ({ source, index: source.index }))
      .filter(({ source }) => /invoice|rechnung/i.test(`${source.title} ${source.tags}`))
      .filter(({ source }) => !/\bpaid\b/i.test(source.tags || ''))
      .map(({ index }) => index);

    if (preferred.length > 0) {
      return preferred.slice(0, this.maxEscalationDocuments);
    }

    return sources.slice(0, this.maxEscalationDocuments).map((source) => source.index);
  }

  sanitizeRequestedSourceIndexes(requestedSources = [], maxSources) {
    const safeIndexes = [];
    for (const value of Array.isArray(requestedSources) ? requestedSources : []) {
      const index = Number.parseInt(value, 10);
      if (Number.isInteger(index) && index >= 1 && index <= maxSources && !safeIndexes.includes(index)) {
        safeIndexes.push(index);
      }
    }

    return safeIndexes.slice(0, this.maxEscalationDocuments);
  }

  async fetchFullDocumentContent(source) {
    if (!source || !source.doc_id) {
      return null;
    }

    const cacheKey = `${source.doc_id}:${source.last_updated || 'unknown'}`;
    if (this.documentContentCache.has(cacheKey)) {
      return this.documentContentCache.get(cacheKey);
    }

    const fullContent = await paperlessService.getDocumentContent(source.doc_id);
    const cached = {
      docId: source.doc_id,
      title: source.title,
      content: fullContent,
      success: true,
      source
    };
    this.documentContentCache.set(cacheKey, cached);
    return cached;
  }

  /**
   * Check if the RAG service is available and ready
   * @returns {Promise<{status: string, index_ready: boolean, data_loaded: boolean}>}
   */
  async checkStatus() {
    try {
      const client = await this._getClient();
      const response = await client.get(`${this.baseUrl}/status`);
      return response.data;
    } catch (error) {
      console.error('Error checking RAG service status:', error.message);
      return {
        server_up: false,
        data_loaded: false,
        index_ready: false,
        error: error.message
      };
    }
  }

  /**
   * Rewrite a query using the conversation history for better retrieval
   * @param {string} currentQuery - The current user question
   * @returns {Promise<{rewritten_queries: string[], original_query: string, filters?: {from_date?: string, to_date?: string, correspondent?: string}}>}
   */
  async rewriteQuery(currentQuery, explicitFilters = {}, options = {}) {
    try {
      const chatId = options.chatId || 'default';
      const history = this.getHistory(chatId);
      const debug = options.debug === true;
      const aiService = AIServiceFactory.getService();
      
      const context = promptTemplateService.buildRewriteContext(
        currentQuery,
        history,
        {},
        explicitFilters,
        detectLanguageHint(currentQuery)
      );
      
      let prompt;
      try {
        prompt = promptTemplateService.render('rag.query_rewrite', context);
      } catch (templateError) {
        console.warn('[Query Rewrite] Template rendering failed, using fallback:', templateError.message);
        const historyContext = history
          .slice(-this.maxHistoryTurns * 2)
          .map(msg => `${msg.role}: ${msg.content}`)
          .join('\n');
        
        prompt = `Given the conversation history and current question, analyze the question to extract metadata filters.

Current date (for reference): ${new Date().toISOString().split('T')[0]}

Previous conversation:
${historyContext || '(No previous messages)'}

Current question: ${currentQuery}

Extract BOTH from_date AND to_date when the question implies a date range:
- "last month" → from_date = first day of last month, to_date = today
- "last week" → from_date = 7 days ago, to_date = today  
- "March 2026" → from_date = "2026-03-01", to_date = "2026-03-31"
- "this year" → from_date = "2026-01-01", to_date = today
- "today" → from_date = today, to_date = today

Respond with a JSON object:
{"queries": ["search terms"], "filters": {"from_date": "YYYY-MM-DD", "to_date": "YYYY-MM-DD", "correspondent": "optional"}}

Example:
Input: "What documents were added in the last month?"
Output: {"queries": ["recent documents", "new documents"], "filters": {"from_date": "2026-03-13", "to_date": "2026-04-13"}}

If no date range is specified, use {"from_date": "", "to_date": ""}. Output ONLY valid JSON.`;
      }

      const rewrittenResponse = await aiService.generateText(prompt, {
        temperature: 0,
        responseFormat: { type: 'json_object' }
      });
      if (debug) {
        this.appendDebugTrace(chatId, {
          stage: 'rewrite',
          prompt: truncateForDebug(prompt),
          raw_response: truncateForDebug(rewrittenResponse)
        });
      }
      const cleanedResponse = extractJsonPayload(rewrittenResponse) || rewrittenResponse.trim();
      
      // Parse the response to extract queries and filters
      let queries = [currentQuery];
      let filters = {};
      
      try {
        const parsed = JSON.parse(cleanedResponse);
        if (Array.isArray(parsed)) {
          queries = parsed;
        } else if (parsed.queries && Array.isArray(parsed.queries)) {
          queries = parsed.queries;
        }
        if (parsed && parsed.filters && typeof parsed.filters === 'object') {
          filters = parsed.filters;
        }
      } catch (parseError) {
        console.warn('[Query Rewrite] Failed to parse JSON response:', parseError.message);
        const extractedJson = extractJsonPayload(rewrittenResponse);
        if (extractedJson) {
          try {
            const parsed = JSON.parse(extractedJson);
            if (Array.isArray(parsed)) {
              queries = parsed;
            } else if (parsed.queries && Array.isArray(parsed.queries)) {
              queries = parsed.queries;
            }
            if (parsed && parsed.filters && typeof parsed.filters === 'object') {
              filters = parsed.filters;
            }
            const parsedResult = {
              rewritten_queries: queries,
              original_query: currentQuery,
              filters: Object.keys(filters).length > 0 ? filters : extractFallbackFilters(currentQuery)
            };
            if (debug) {
              this.appendDebugTrace(chatId, {
                stage: 'rewrite_result',
                parsed: parsedResult
              });
            }
            return parsedResult;
          } catch (extractedJsonError) {
            console.warn('[Query Rewrite] Failed to parse extracted JSON payload:', extractedJsonError.message);
          }
        }

        // Try to extract queries from lines as fallback
        const lines = rewrittenResponse.split('\n').filter(line => line.trim() && !line.startsWith('```'));
        queries = lines.slice(0, 3).map(q => q.replace(/^[-*\d.]\s*/, '').trim()).filter(q => q.length > 0);
        if (queries.length === 0) {
          queries = [currentQuery];
        }
      }
      
      const fallbackFilters = Object.keys(filters).length > 0 ? filters : extractFallbackFilters(currentQuery);
      const result = {
        rewritten_queries: queries,
        original_query: currentQuery,
        filters: fallbackFilters
      };
      if (debug) {
        this.appendDebugTrace(chatId, {
          stage: 'rewrite_result',
          parsed: result
        });
      }
      return result;
    } catch (error) {
      console.error('Error rewriting query:', error.message);
      // Fallback to original query on error
      return {
        rewritten_queries: [currentQuery],
        original_query: currentQuery
      };
    }
  }

  /**
   * Add a message to conversation history
   * @param {string} role - 'user' or 'assistant'
   * @param {string} content - The message content
   */
  addToHistory(role, content) {
    this.addToHistoryForChat('default', role, content);
  }

  addToHistoryForChat(chatId = 'default', role, content) {
    const state = this.ensureChatState(chatId);
    state.history.push({ role, content, timestamp: Date.now() });
    state.history = this.buildTurnScopedHistory(state.history);
    state.lastUpdatedAt = Date.now();
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.clearHistoryForChat('default');
  }

  clearHistoryForChat(chatId = 'default') {
    const state = this.ensureChatState(chatId);
    state.history = [];
    state.debugTrace = [];
    state.activeResultSet = null;
    state.lastUpdatedAt = Date.now();
  }

  classifyTurnIntent(question, chatId = 'default') {
    const normalized = normalizeQuestionText(question);
    const activeResultSet = this.getActiveResultSet(chatId);

    if (!activeResultSet || !Array.isArray(activeResultSet.sources) || activeResultSet.sources.length === 0) {
      return { intent: 'new_search', reason: 'No active result set available.' };
    }

    const explicitTopicShift = hasAnyToken(normalized, [
      /\bunrelated\b/,
      /\binstead\b/,
      /\bforget that\b/,
      /\bnew topic\b/,
      /\banother question\b/,
      /\bnow show me\b/,
      /\bshow me\b.+\b(contract|letter|statement|insurance|bank|receipt|document type)\b/,
      /\bjetzt\b.+\b(vertrag|brief|versicherung|kontoauszug)\b/
    ]);

    if (explicitTopicShift) {
      return { intent: 'new_search', reason: 'Explicit topic shift detected.' };
    }

    const followUpReference = hasAnyToken(normalized, [
      /\bthem\b/,
      /\bthose\b/,
      /\bthese\b/,
      /\bwhich of them\b/,
      /\bwhat do i still\b/,
      /\bwhich amount\b/,
      /\bhow much\b/,
      /\bof those\b/,
      /\bof these\b/,
      /\bwelche davon\b/,
      /\bdavon\b/,
      /\bdiese\b/,
      /\bderen\b/,
      /\bwas muss ich noch zahlen\b/,
      /\bwelchen betrag\b/
    ]);

    const retrievalLikeRequest = hasAnyToken(normalized, [
      /\bshow me\b/,
      /\bfind\b/,
      /\blist\b/,
      /\bsearch\b/,
      /\bwhat .* do i have\b/,
      /\bwhich .* do i have\b/,
      /\bwelche .* habe ich\b/
    ]);

    const shortQuestion = normalized.split(/\s+/).filter(Boolean).length <= 10;
    const activeTitles = activeResultSet.sources.map((source) => normalizeQuestionText(source.title)).filter(Boolean);
    const referencesKnownDocs = activeTitles.some((title) => title && normalized.includes(title.slice(0, Math.min(title.length, 24))));

    if (followUpReference || (shortQuestion && !retrievalLikeRequest) || referencesKnownDocs) {
      return { intent: 'reuse_active_set', reason: 'Follow-up phrasing or active document reference detected.' };
    }

    return { intent: 'new_search', reason: 'Question appears to request a new retrieval set.' };
  }

  buildLightweightPlannerResult(rawText, fallbackAnswer = '') {
    const cleaned = extractJsonPayload(rawText) || String(rawText || '').trim();
    const parsed = safeJsonParse(cleaned, null);
    if (parsed && typeof parsed === 'object') {
      return {
        answer: typeof parsed.answer === 'string' ? parsed.answer.trim() : fallbackAnswer,
        citations: Array.isArray(parsed.citations) ? parsed.citations : [],
        needs_deeper_evidence: Boolean(parsed.needs_deeper_evidence),
        required_sources: Array.isArray(parsed.required_sources) ? parsed.required_sources : [],
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        confidence: typeof parsed.confidence === 'string' ? parsed.confidence : ''
      };
    }

    return {
      answer: String(rawText || fallbackAnswer || '').trim(),
      citations: [],
      needs_deeper_evidence: false,
      required_sources: [],
      reason: '',
      confidence: ''
    };
  }

  async planAnswerEvidence({ question, chatId, finalFilters, sources, debug }) {
    const aiService = AIServiceFactory.getService();
    const languageHint = detectLanguageHint(question);
    const plannerContext = promptTemplateService.buildAnswerPlannerContext(
      question,
      this.getHistory(chatId),
      finalFilters,
      sources,
      languageHint
    );
    const prompt = promptTemplateService.render('rag.answer_plan', plannerContext);
    
    let plannerPayload;
    try {
      plannerPayload = await aiService.generateText(prompt, {
        temperature: 0,
        responseFormat: { type: 'json_object' },
        returnMessageParts: true,
        enableThinking: true
      });
    } catch (error) {
      plannerPayload = {
        text: '',
        content: '',
        reasoningContent: '',
        providerDiagnostics: { error: error.message }
      };
    }

    const rawResponse = typeof plannerPayload === 'string'
      ? plannerPayload
      : plannerPayload?.text || plannerPayload?.content || plannerPayload?.reasoningContent || '';
    let plannerResult = this.buildLightweightPlannerResult(rawResponse);

    if (!plannerResult.answer && !plannerResult.needs_deeper_evidence) {
      plannerResult = {
        answer: '',
        citations: [],
        needs_deeper_evidence: this.shouldForceEscalation(question, plannerResult),
        required_sources: this.inferEscalationIndexes(question, sources),
        reason: 'Planner response was empty or unusable; using heuristic escalation.',
        confidence: 'low'
      };
    }

    

    if (debug) {
      this.appendDebugTrace(chatId, {
        stage: 'answer_planner',
        prompt: truncateForDebug(prompt),
        raw_response: truncateForDebug(rawResponse),
        parsed: plannerResult,
        providerDiagnostics: plannerPayload?.providerDiagnostics || null
      });
    }
    return plannerResult;
  }

  async fetchRequestedFullDocuments(sources, requestedIndexes = [], debugInfo = null) {
    const selectedSources = requestedIndexes
      .map((index) => sources[index - 1])
      .filter(Boolean)
      .slice(0, this.maxEscalationDocuments);

    const documents = [];
    for (const source of selectedSources) {
      try {
        const fullDocument = await this.fetchFullDocumentContent(source);
        if (fullDocument && fullDocument.content) {
          documents.push({
            title: source.title || fullDocument.title || '',
            content: fullDocument.content,
            correspondent: source.correspondent || '',
            documentTypeName: source.document_type || '',
            createdDate: source.date || '',
            tags: source.tags || ''
          });
        }
      } catch (error) {
        if (debugInfo) {
          debugInfo.failures.push({ doc_id: source.doc_id, error: error.message });
        }
      }
    }

    return documents;
  }

  /**
   * Search for documents matching a query
   * @param {string} query - The search query
   * @param {Object} filters - Optional filters for search
   * @returns {Promise<Array>} - Array of search results
   */
  async search(query, filters = {}) {
    try {
      const client = await this._getClient();
      const response = await client.post(`${this.baseUrl}/search`, {
        query,
        ...filters
      });
      return response.data;
    } catch (error) {
      console.error('Error searching documents:', error);
      throw error;
    }
  }

  /**
   * Ask a question about documents and get an AI-generated answer in the same language as the question
   * @param {string} question - The question to ask
   * @param {Object} options - Optional options
   * @param {boolean} options.enableRewrite - Whether to enable query rewriting (default: true)
   * @returns {Promise<{answer: string, reasoning?: string, has_reasoning?: boolean, sources: Array, rewritten_queries?: string[]}>} - AI response and source documents
   */
  async askQuestion(question, options = {}) {
    const enableRewrite = options.enableRewrite !== false;
    const explicitFilters = options.filters || {};
    const chatId = options.chatId || 'default';
    const debug = options.debug === true;
    
    try {
      const client = await this._getClient();
      if (debug) {
        this.setDebugTrace(chatId, []);
      }

      const turnIntent = this.classifyTurnIntent(question, chatId);
      
      if (debug) {
        this.appendDebugTrace(chatId, {
          stage: 'turn_intent',
          intent: turnIntent.intent,
          reason: turnIntent.reason
        });
      }
      
      // Step 0: Optional query rewriting (always run to detect metadata filters)
      let finalQuestion = question;
      let rewrittenQueries = null;
      let finalFilters = mergeFilters({}, explicitFilters);
      let sources;
      let retrievalQueries = [question];
      const activeResultSet = this.getActiveResultSet(chatId);
      
      if (enableRewrite && turnIntent.intent !== 'reuse_active_set') {
        try {
          const rewriteResult = await this.rewriteQuery(question, explicitFilters, { chatId, debug });
          rewrittenQueries = rewriteResult.rewritten_queries;
          const extractedFilters = rewriteResult.filters || {};
          finalFilters = mergeFilters(extractedFilters, explicitFilters);
          retrievalQueries = Array.isArray(rewrittenQueries) && rewrittenQueries.length > 0
            ? rewrittenQueries
            : [question];
          if (rewrittenQueries && rewrittenQueries[0] && rewrittenQueries[0] !== question) {
            finalQuestion = rewrittenQueries[0];
          }
        } catch (rewriteError) {
          console.error('[Query Rewrite] Failed, using original query:', rewriteError.message);
        }
      }

      if (turnIntent.intent === 'reuse_active_set' && activeResultSet) {
        sources = Array.isArray(activeResultSet.sources) ? activeResultSet.sources : [];
        finalFilters = mergeFilters(activeResultSet.filters || {}, explicitFilters);
        retrievalQueries = Array.isArray(activeResultSet.retrievalQueries) && activeResultSet.retrievalQueries.length > 0
          ? activeResultSet.retrievalQueries
          : [activeResultSet.question || question];
      } else {
        const retrievalResult = await this.retrieveSourcesForQueries(client, retrievalQueries, {
          from_date: finalFilters.from_date,
          to_date: finalFilters.to_date,
          correspondent: finalFilters.correspondent,
          originalQuestion: question
        });

        sources = retrievalResult.sources;
        retrievalQueries = retrievalResult.retrievalQueries;
        this.setActiveResultSet(chatId, {
          question: finalQuestion,
          originalQuestion: question,
          filters: finalFilters,
          retrievalQueries,
          sources,
          perQueryStats: retrievalResult.perQueryStats,
          createdAt: Date.now()
        });
      }

      

      if (debug) {
        this.appendDebugTrace(chatId, {
          stage: 'retrieval',
          query: finalQuestion,
          retrieval_queries: retrievalQueries,
          filters: finalFilters,
          sources,
          source_origin: turnIntent.intent === 'reuse_active_set' ? 'active_result_set' : 'fresh_retrieval'
        });
      }

      const plannerResult = await this.planAnswerEvidence({
        question,
        chatId,
        finalFilters,
        sources,
        debug
      });

      const heuristicIndexes = this.inferEscalationIndexes(question, sources);
      const requestedIndexes = this.sanitizeRequestedSourceIndexes(
        plannerResult.required_sources && plannerResult.required_sources.length > 0
          ? plannerResult.required_sources
          : heuristicIndexes,
        sources.length
      );
      const shouldEscalate = (this.shouldForceEscalation(question, plannerResult) || this.hasMixedPaymentSignals(sources)) && requestedIndexes.length > 0;
      const escalationDebug = { requested_indexes: requestedIndexes, failures: [] };
      let selectedDocuments = [];

      if (shouldEscalate) {
        selectedDocuments = await this.fetchRequestedFullDocuments(sources, requestedIndexes, escalationDebug);
      }

      if (debug) {
        this.appendDebugTrace(chatId, {
          stage: 'escalation',
          planner_requested_sources: plannerResult.required_sources,
          requested_indexes: requestedIndexes,
          escalated: shouldEscalate,
          fetched_documents: selectedDocuments.map((doc, index) => ({
            index: requestedIndexes[index],
            title: doc.title,
            content_preview: truncateForDebug(doc.content, 500)
          })),
          failures: escalationDebug.failures
        });
      }

      

      const aiService = AIServiceFactory.getService();
      const history = this.getHistory(chatId);
      const languageHint = detectLanguageHint(question);
      let prompt;
      let providerDiagnostics = null;

      if (shouldEscalate && selectedDocuments.length > 0) {
        const answerContext = promptTemplateService.buildAnswerContext(
          question,
          history,
          finalFilters,
          sources,
          selectedDocuments,
          languageHint
        );
        prompt = promptTemplateService.render('rag.answer_final', answerContext);
      } else {
        const answerContext = promptTemplateService.buildAnswerPlannerContext(
          question,
          history,
          finalFilters,
          sources,
          languageHint
        );
        prompt = promptTemplateService.render('rag.answer_lightweight', answerContext);
      }

      if (debug) {
        this.appendDebugTrace(chatId, {
          stage: 'final_answer_prompt',
          prompt: truncateForDebug(prompt),
          mode: shouldEscalate && selectedDocuments.length > 0 ? 'deep' : 'lightweight'
        });
      }

      

      let answer;
      let reasoning = '';
      try {
        const answerResult = await aiService.generateText(prompt, {
          temperature: 0.2,
          enableThinking: true,
          returnMessageParts: true
        });
        if (typeof answerResult === 'string') {
          answer = answerResult;
        } else {
          answer = answerResult?.text || answerResult?.content || '';
          reasoning = answerResult?.reasoningContent || '';
          providerDiagnostics = answerResult?.providerDiagnostics || null;
        }
      } catch (error) {
        console.error('Error generating answer with AI service:', error);
        answer = "An error occurred while generating an answer. Please try again later.";
        providerDiagnostics = { error: error.message };
      }

      if ((!answer || looksLikeGarbageAnswer(answer)) && plannerResult.answer && !looksLikeGarbageAnswer(plannerResult.answer) && !shouldEscalate) {
        answer = plannerResult.answer;
      }

      
      
      // Add to conversation history for follow-up handling
      this.addToHistoryForChat(chatId, 'user', question);
      this.addToHistoryForChat(chatId, 'assistant', answer);
      if (debug) {
        this.appendDebugTrace(chatId, {
          stage: 'final_answer_response',
          answer: truncateForDebug(answer, 3000),
          reasoning: truncateForDebug(reasoning, 3000),
          providerDiagnostics
        });
      }
      
      const result = {
        answer,
        ...(reasoning && { reasoning, has_reasoning: true }),
        sources,
        ...(rewrittenQueries && { rewritten_queries: rewrittenQueries }),
        ...(debug && { debug_trace: this.getDebugTrace(chatId) })
      };
      
      return result;
    } catch (error) {
      
      console.error('Error in askQuestion:', error);
      throw new Error("An error occurred while processing your question. Please try again later.");
    }
  }

  /**
   * Start indexing documents in the RAG service
   * @param {boolean} force - Whether to force refresh from source
   * @returns {Promise<Object>} - Indexing status
   */
  async indexDocuments(force = false) {
    try {
      const client = await this._getClient();
      const response = await client.post(`${this.baseUrl}/indexing/start`, { 
        force, 
        background: true 
      });
      return response.data;
    } catch (error) {
      console.error('Error indexing documents:', error);
      throw error;
    }
  }

  /**
   * Check if the RAG service needs document updates
   * @returns {Promise<{needs_update: boolean, message: string}>}
   */
  async checkForUpdates() {
    try {
      const client = await this._getClient();
      const response = await client.post(`${this.baseUrl}/indexing/check`);
      return response.data;
    } catch (error) {
      console.error('Error checking for updates:', error);
      throw error;
    }
  }

  /**
   * Get current indexing status
   * @returns {Promise<Object>} - Current indexing status
   */
  async getIndexingStatus() {
    try {
      const client = await this._getClient();
      const response = await client.get(`${this.baseUrl}/indexing/status`);
      return response.data;
    } catch (error) {
      console.error('Error getting indexing status:', error);
      throw error;
    }
  }

  /**
   * Initialize the RAG service
   * @param {boolean} force - Whether to force initialization
   * @returns {Promise<Object>} - Initialization status
   */
  async initialize(force = false) {
    try {
      const client = await this._getClient();
      const response = await client.post(`${this.baseUrl}/initialize`, { force });
      return response.data;
    } catch (error) {
      console.error('Error initializing RAG service:', error);
      throw error;
    }
  }

  /**
   * Force clear model cache and re-download models
   * @returns {Promise<Object>} - Model refresh status
   */
  async redownloadModels() {
    try {
      const client = await this._getClient();
      const response = await client.post(`${this.baseUrl}/models/redownload`, {
        background: true
      });
      return response.data;
    } catch (error) {
      console.error('Error triggering model re-download:', error);
      throw error;
    }
  }

  /**
   * Schedule a restart of the Python RAG service process.
   * @param {{reason?: string, delaySeconds?: number}} options
   * @returns {Promise<Object>}
   */
  async restartPythonService(options = {}) {
    const { reason = 'config_save', delaySeconds = 0.75 } = options;

    try {
      const client = await this._getClient();
      const response = await client.post(
        `${this.baseUrl}/system/restart`,
        {
          reason,
          delay_seconds: delaySeconds
        },
        {
          timeout: 3000
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error scheduling Python RAG service restart:', error.message || error);
      throw error;
    }
  }

  /**
   * Get AI status
   * @returns {Promise<{status: string}>}
   */
  async getAIStatus({ force = false } = {}) {
    const now = Date.now();
    const hasFreshCache =
      !force &&
      this.aiStatusCache &&
      now - this.aiStatusCacheTs < this.aiStatusTtlMs;

    // Avoid expensive provider ping calls on each UI polling interval.
    if (hasFreshCache) {
      return this.aiStatusCache;
    }

    try {
      const aiService = AIServiceFactory.getService();
      const status = await aiService.checkStatus();
      this.aiStatusCache = status || { status: 'unknown' };
      this.aiStatusCacheTs = now;
      return this.aiStatusCache;
    } catch (error) {
      console.error('Error checking AI service status:', error);
      if (this.aiStatusCache) {
        return this.aiStatusCache;
      }

      return { status: 'error', error: error.message || 'AI status unavailable' };
    }
  }
}


module.exports = new RagService();
