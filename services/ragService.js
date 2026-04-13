// services/ragService.js
const axios = require('axios');
const config = require('../config/config');
const AIServiceFactory = require('./aiServiceFactory');
const paperlessService = require('./paperlessService');

const DEFAULT_TIMEOUT = 30000;

class RagService {
  constructor() {
    this.baseUrl = process.env.RAG_SERVICE_URL || 'http://localhost:8000';
    this.aiStatusCache = null;
    this.aiStatusCacheTs = 0;
    this.aiStatusTtlMs = Number(process.env.RAG_AI_STATUS_TTL_MS || 300000);
    this.conversationHistory = []; // Store last N messages for query rewriting
    this.maxHistoryMessages = 5;
  }

  async _getClient() {
    return axios.create({ timeout: DEFAULT_TIMEOUT });
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
   * @returns {Promise<{rewritten_queries: string[], original_query: string}>}
   */
  async rewriteQuery(currentQuery) {
    try {
      const aiService = AIServiceFactory.getService();
      
      // Build conversation context from history
      const historyContext = this.conversationHistory
        .slice(-this.maxHistoryMessages)
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');
      
const prompt = `Given the conversation history and current question, generate 2-3 improved search queries that would retrieve better context for answering the question.

Previous conversation:
${historyContext || '(No previous messages)'}

Current question: ${currentQuery}

Generate exactly 2-3 search queries as a JSON array of strings. Each query should be self-contained and capture the key information from the conversation that helps retrieve relevant documents. Output ONLY the JSON array, nothing else.`;

      const rewrittenQueries = await aiService.generateText(prompt);
      console.log(`[Query Rewrite] Raw response: ${rewrittenQueries.substring(0, 200)}`);
      
      // Parse the response to extract queries
      let queries = [];
      try {
        // Try to parse as JSON array
        queries = JSON.parse(rewrittenQueries.trim());
        if (!Array.isArray(queries)) {
          console.warn('[Query Rewrite] Response is not an array, using original query');
          queries = [currentQuery];
        }
      } catch (parseError) {
        // If not JSON, try to extract lines
        console.warn('[Query Rewrite] Failed to parse JSON, trying line extraction');
        const lines = rewrittenQueries.split('\n').filter(line => line.trim() && !line.startsWith('```'));
        queries = lines.slice(0, 3).map(q => q.replace(/^[-*\d.]\s*/, '').trim()).filter(q => q.length > 0);
        if (queries.length === 0) {
          console.warn('[Query Rewrite] No queries extracted, using original');
          queries = [currentQuery];
        }
      }
      
      return {
        rewritten_queries: queries,
        original_query: currentQuery
      };
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
    this.conversationHistory.push({ role, content, timestamp: Date.now() });
    // Keep only last N messages
    if (this.conversationHistory.length > this.maxHistoryMessages * 2) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryMessages);
    }
    console.log(`[History] Added ${role} message. History now has ${this.conversationHistory.length} messages.`);
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
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
   * @returns {Promise<{answer: string, sources: Array, rewritten_queries?: string[]}>} - AI response and source documents
   */
  async askQuestion(question, options = {}) {
    const enableRewrite = options.enableRewrite !== false;
    
    try {
      const client = await this._getClient();
      
      // Step 0: Optional query rewriting using conversation history
      let finalQuestion = question;
      let rewrittenQueries = null;
      
      if (enableRewrite && this.conversationHistory.length > 0) {
        try {
          const rewriteResult = await this.rewriteQuery(question);
          rewrittenQueries = rewriteResult.rewritten_queries;
          // Use the first rewritten query as the main search query
          finalQuestion = rewrittenQueries[0];
          console.log('[Query Rewrite] Original:', question, '-> Rewritten:', rewrittenQueries);
        } catch (rewriteError) {
          console.error('[Query Rewrite] Failed, using original query:', rewriteError.message);
        }
      }
      
      // 1. Get context from the RAG service
      const response = await client.post(`${this.baseUrl}/context`, { 
        question: finalQuestion,
        max_sources: 5
      });
      
      const { context, sources: originalSources } = response.data;
      
      // 2. Fetch full content for each source document using doc_id
      let enhancedContext = context;
      let sources = originalSources;
      const failedDocIds = [];
      const MAX_CONTEXT_TOKENS = 8000;
      const CHARS_PER_TOKEN = 4;
      const maxContextChars = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN;
      
      if (sources && sources.length > 0) {
        // Fetch full document content for each source
        const fullDocContents = await Promise.all(
          sources.map(async (source) => {
            if (source.doc_id) {
              try {
                const fullContent = await paperlessService.getDocumentContent(source.doc_id);
                return { docId: source.doc_id, title: source.title, content: fullContent, success: true };
              } catch (error) {
                console.error(`Error fetching content for document ${source.doc_id}:`, error.message);
                failedDocIds.push(source.doc_id);
                return { docId: source.doc_id, title: source.title, content: null, success: false };
              }
            }
            return null;
          })
        );
        
        // Build enhanced context with token limit
        let totalChars = context.length;
        const includedDocs = [];
        
        for (const doc of fullDocContents) {
          if (!doc || !doc.content) continue;
          
          const docText = `Full document content for ${doc.title || 'Document ' + doc.docId}:\n${doc.content}`;
          
          // Check if adding this document would exceed the limit
          if (totalChars + docText.length > maxContextChars) {
            // Try to fit a truncated version
            const remainingChars = maxContextChars - totalChars - 50; // 50 for the wrapper text
            if (remainingChars > 500) {
              const truncatedText = `Full document content for ${doc.title || 'Document ' + doc.docId}:\n${doc.content.substring(0, remainingChars)}...\n[truncated]`;
              includedDocs.push(truncatedText);
              totalChars += truncatedText.length;
            }
            break; // No more docs can fit
          }
          
          includedDocs.push(docText);
          totalChars += docText.length;
        }
        
        if (includedDocs.length > 0) {
          enhancedContext = context + '\n\n' + includedDocs.join('\n\n');
        }
        
        // Update sources to only include successfully fetched docs
        sources = sources.filter(s => !failedDocIds.includes(s.doc_id));
      }
      
      // 3. Use AI service to generate an answer based on the enhanced context
      const aiService = AIServiceFactory.getService();
      
      // Build source reference for citation generation
      const sourceRef = sources.map((s, idx) => `[${idx + 1}] ${s.title || 'Document ' + s.doc_id}`).join('\n');
      
      // Build conversation context for better follow-up understanding
      const conversationContext = this.conversationHistory.length > 0
        ? `Previous conversation:\n${this.conversationHistory.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.substring(0, 300)}`).join('\n')}\n\n`
        : '';
      
      // Create a language-agnostic prompt that works in any language
      const prompt = `
        You are a helpful assistant that answers questions about documents.

        ${conversationContext}Answer the following question precisely, based on the provided documents:

        Question: ${question}

        Available sources:
        ${sourceRef}

        Context from relevant documents:
        ${enhancedContext}

        Important instructions:
        - Use ONLY information from the provided documents
        - If the answer is not contained in the documents, respond: "This information is not contained in the documents." (in the same language as the question)
        - Avoid assumptions or speculation beyond the given context
        - Answer in the same language as the question was asked
        - After each sentence or paragraph that uses information from a specific source, insert a citation like [1], [2], etc. at the end of that sentence
        - Use the source numbers [1], [2], etc. to reference the document sources listed above
        - Do NOT make up citation numbers - only use citations that correspond to the sources provided
        - When answering follow-up questions, consider the previous conversation context to understand what "it", "that", "the document", etc. refers to
        `;

      let answer;
      try {
        answer = await aiService.generateText(prompt);
      } catch (error) {
        console.error('Error generating answer with AI service:', error);
        answer = "An error occurred while generating an answer. Please try again later.";
      }
      
      // Add to conversation history for follow-up handling
      this.addToHistory('user', question);
      this.addToHistory('assistant', answer);
      
      const result = {
        answer,
        sources,
        ...(rewrittenQueries && { rewritten_queries: rewrittenQueries })
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
