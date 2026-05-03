// routes/rag.js
const express = require('express');
const router = express.Router();
const ragService = require('../services/ragService');
const promptTemplateService = require('../services/promptTemplateService');

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * @swagger
 * /api/rag/search:
 *   post:
 *     summary: Search indexed documents
 *     description: Performs a hybrid RAG search across indexed documents using the provided query and optional filters.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 example: "invoice march 2026"
 *               from_date:
 *                 type: string
 *                 format: date
 *               to_date:
 *                 type: string
 *                 format: date
 *               correspondent:
 *                 type: string
 *     responses:
 *       200:
 *         description: Search results returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Missing required query
 *       500:
 *         description: Internal server error
 */
router.post('/search', async (req, res) => {
  try {
    const { query, from_date, to_date, correspondent } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const filters = {};
    if (from_date) filters.from_date = from_date;
    if (to_date) filters.to_date = to_date;
    if (correspondent) filters.correspondent = correspondent;
    
    const results = await ragService.search(query, filters);
    res.json(results);
  } catch (error) {
    console.error('Error in /api/rag/search:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/ask:
 *   post:
 *     summary: Ask a question against indexed documents
 *     description: Returns an AI-generated answer grounded in indexed document content.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question
 *               - chatId
 *             properties:
 *               question:
 *                 type: string
 *                 example: "Which invoices are overdue?"
 *               chatId:
 *                 type: string
 *                 description: Unique identifier for the conversation session
 *                 example: "chat-abc123"
 *               debug:
 *                 type: boolean
 *                 description: Include debug trace in the response
 *                 default: false
 *               from_date:
 *                 type: string
 *                 format: date
 *                 description: Filter documents created on or after this date (YYYY-MM-DD)
 *                 example: "2026-01-01"
 *               to_date:
 *                 type: string
 *                 format: date
 *                 description: Filter documents created on or before this date (YYYY-MM-DD)
 *                 example: "2026-04-30"
 *               correspondent:
 *                 type: string
 *                 description: Filter documents by correspondent name
 *                 example: "Acme Corp"
 *     responses:
 *       200:
 *         description: Answer generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Missing required question or chatId
 *       500:
 *         description: Internal server error
 */
router.post('/ask', async (req, res) => {
  try {
    const {
      question,
      chatId,
      debug = false,
      from_date,
      to_date,
      correspondent
    } = req.body;
    
    if (!normalizeOptionalString(question)) {
      return res.status(400).json({ error: 'Question is required' });
    }

    if (!normalizeOptionalString(chatId)) {
      return res.status(400).json({ error: 'chatId is required' });
    }

    if (from_date && !isIsoDate(from_date)) {
      return res.status(400).json({ error: 'from_date must be YYYY-MM-DD' });
    }

    if (to_date && !isIsoDate(to_date)) {
      return res.status(400).json({ error: 'to_date must be YYYY-MM-DD' });
    }
    
    const result = await ragService.askQuestion(question, {
      chatId: chatId.trim(),
      debug: Boolean(debug),
      filters: {
        from_date: normalizeOptionalString(from_date),
        to_date: normalizeOptionalString(to_date),
        correspondent: normalizeOptionalString(correspondent)
      }
    });
    res.json(result);
  } catch (error) {
    console.error('Error in /api/rag/ask:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/index:
 *   post:
 *     summary: Start document indexing
 *     description: Starts or re-runs indexing in the RAG backend.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               force:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: Indexing triggered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       500:
 *         description: Internal server error
 */
router.post('/index', async (req, res) => {
  try {
    const { force = false } = req.body;
    const result = await ragService.indexDocuments(force);
    res.json(result);
  } catch (error) {
    console.error('Error in /api/rag/index:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/index/status:
 *   get:
 *     summary: Get indexing status
 *     description: Returns current status information for RAG indexing.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Indexing status returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       500:
 *         description: Internal server error
 */
router.get('/index/status', async (req, res) => {
  try {
    const status = await ragService.getIndexingStatus();
    res.json(status);
  } catch (error) {
    console.error('Error in /api/rag/index/status:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/index/check:
 *   get:
 *     summary: Check whether re-indexing is required
 *     description: Compares source state and returns whether RAG index updates are needed.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Check completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       500:
 *         description: Internal server error
 */
router.get('/index/check', async (req, res) => {
  try {
    const result = await ragService.checkForUpdates();
    res.json(result);
  } catch (error) {
    console.error('Error in /api/rag/index/check:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/status:
 *   get:
 *     summary: Get RAG backend status
 *     description: Returns status details for RAG service and AI backend connectivity.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Status returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       500:
 *         description: Internal server error
 */
router.get('/status', async (req, res) => {
  try {
    const status = await ragService.checkStatus();
    try {
      const aiStatus = await ragService.getAIStatus();
      status.ai_status = aiStatus.status;
      status.ai_model = aiStatus.model;
    } catch (aiError) {
      console.error('Error checking AI status:', aiError);
      status.ai_status = 'unknown';
      status.ai_model = 'Unknown';
    }
    // console.log('RAG Status:', status);
    // console.log('AI Status:', aiStatus);
    res.json(status);
  } catch (error) {
    console.error('Error in /api/rag/status:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/initialize:
 *   post:
 *     summary: Initialize RAG service
 *     description: Initializes RAG components and optionally forces a full refresh.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               force:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: Initialization completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       500:
 *         description: Internal server error
 */
router.post('/initialize', async (req, res) => {
  try {
    const { force = false } = req.body;
    const result = await ragService.initialize(force);
    res.json(result);
  } catch (error) {
    console.error('Error in /api/rag/initialize:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/prompts:
 *   get:
 *     summary: List all prompt templates
 *     description: Returns registry of all available prompt templates with their status.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of prompt templates
 *       500:
 *         description: Internal server error
 */
router.get('/prompts', async (req, res) => {
  try {
    const templates = promptTemplateService.listTemplates();
    res.json({ templates });
  } catch (error) {
    console.error('Error in /api/rag/prompts:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/prompts/:id:
 *   get:
 *     summary: Get a prompt template
 *     description: Returns the content of a specific prompt template.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Template content
 *       404:
 *         description: Template not found
 *       500:
 *         description: Internal server error
 */
router.get('/prompts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let content;
    try {
      content = promptTemplateService.getTemplateContent(id);
    } catch (notFound) {
      return res.status(404).json({ error: 'Template not found' });
    }
    res.json({ id, content });
  } catch (error) {
    console.error('Error in /api/rag/prompts/:id:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/prompts/:id:
 *   put:
 *     summary: Save a prompt template override
 *     description: Saves an override for a prompt template.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Template saved
 *       400:
 *         description: Invalid template content
 *       500:
 *         description: Internal server error
 */
router.put('/prompts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }

    const validation = promptTemplateService.validateTemplate(id, content);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Invalid template syntax', details: validation.error });
    }

    promptTemplateService.saveOverride(id, content);
    res.json({ success: true, id });
  } catch (error) {
    console.error('Error in PUT /api/rag/prompts/:id:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/prompts/:id/reset:
 *   post:
 *     summary: Reset a prompt template to default
 *     description: Removes the override and restores the default template.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Template reset
 *       500:
 *         description: Internal server error
 */
router.post('/prompts/:id/reset', async (req, res) => {
  try {
    const { id } = req.params;
    promptTemplateService.resetToDefault(id);
    res.json({ success: true, id });
  } catch (error) {
    console.error('Error in POST /api/rag/prompts/:id/reset:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/prompts/:id/preview:
 *   get:
 *     summary: Preview a prompt template
 *     description: Renders a prompt template with sample context data.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: useLiveContext
 *         schema:
 *           type: boolean
 *         description: If true, uses live RAG context instead of sample data
 *     responses:
 *       200:
 *         description: Rendered template
 *       404:
 *         description: Template not found
 *       500:
 *         description: Internal server error
 */
router.get('/prompts/:id/preview', async (req, res) => {
  try {
    const { id } = req.params;
    const { useLiveContext } = req.query;

    let context;
    if (useLiveContext === 'true') {
      const chatId = normalizeOptionalString(req.query.chatId) || 'default';
      context = promptTemplateService.buildRewriteContext(
        'What invoices did I receive last month?',
        ragService.getHistory(chatId).slice(-5),
        {},
        {},
        'en'
      );
    } else {
      context = promptTemplateService.getSampleContext(id);
      if (!context) {
        context = promptTemplateService.buildRewriteContext(
          'Sample question',
          [],
          {},
          {},
          'en'
        );
      }
    }

    let rendered;
    try {
      rendered = promptTemplateService.render(id, context);
    } catch (renderError) {
      return res.status(500).json({ error: 'Template render failed', details: renderError.message });
    }

    res.json({ id, rendered });
  } catch (error) {
    console.error('Error in /api/rag/prompts/:id/preview:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/prompts/:id/preview:
 *   post:
 *     summary: Preview a prompt template with custom content
 *     description: Renders a prompt template with custom content and sample context data.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: useLiveContext
 *         schema:
 *           type: boolean
 *         description: If true, uses live RAG context instead of sample data
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Rendered template
 *       404:
 *         description: Template not found
 *       500:
 *         description: Internal server error
 */
router.post('/prompts/:id/preview', async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body || {};
    const { useLiveContext } = req.query;

    let context;
    if (useLiveContext === 'true') {
      const chatId = normalizeOptionalString(req.query.chatId) || 'default';
      const liveHistory = ragService.getHistory(chatId).slice(-5);
      if (id === 'rag.query_rewrite') {
        context = promptTemplateService.buildRewriteContext(
          'What invoices did I receive last month?',
          liveHistory,
          {},
          {},
          'en'
        );
      } else if (id === 'rag.answer_plan' || id === 'rag.answer_lightweight') {
        context = promptTemplateService.buildAnswerPlannerContext(
          'What invoices did I receive last month?',
          liveHistory,
          {},
          [],
          'en'
        );
      } else if (id === 'rag.answer_final') {
        context = promptTemplateService.buildAnswerContext(
          'What invoices did I receive last month?',
          liveHistory,
          {},
          [],
          [],
          'en'
        );
      } else {
        context = promptTemplateService.getSampleContext(id);
        if (!context) {
          console.warn(`[prompts/preview] No sample context for template id '${id}' in live context mode; falling back to empty context`);
          context = {};
        }
      }
    } else {
      context = promptTemplateService.getSampleContext(id);
      if (!context) {
        context = promptTemplateService.buildRewriteContext(
          'Sample question',
          [],
          {},
          {},
          'en'
        );
      }
    }

    let rendered;
    try {
      if (content) {
        rendered = promptTemplateService.engine.parseAndRenderSync(content, { context });
      } else {
        rendered = promptTemplateService.render(id, context);
      }
    } catch (renderError) {
      return res.status(500).json({ error: 'Template render failed', details: renderError.message });
    }

    res.json({ id, rendered });
  } catch (error) {
    console.error('Error in POST /api/rag/prompts/:id/preview:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

function requireDebugRoutes(req, res, next) {
  if (process.env.RAG_DEBUG_ROUTES !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

/**
 * @swagger
 * /api/rag/test/query-rewrite:
 *   post:
 *     summary: Test query rewriting
 *     description: Test the query rewriting feature with conversation history. Only available when RAG_DEBUG_ROUTES=true.
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               query:
 *                 type: string
 *                 example: "What was the total amount?"
 *     responses:
 *       200:
 *         description: Rewritten queries
 *       404:
 *         description: Not found (RAG_DEBUG_ROUTES not enabled)
 */
router.post('/test/query-rewrite', requireDebugRoutes, async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const result = await ragService.rewriteQuery(query);
    res.json(result);
  } catch (error) {
    console.error('Error in /api/rag/test/query-rewrite:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/test/history:
 *   get:
 *     summary: Get conversation history
 *     description: Get the current conversation history for query rewriting
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Conversation history
 */
router.get('/test/history', requireDebugRoutes, async (req, res) => {
  try {
    const chatId = normalizeOptionalString(req.query.chatId) || 'default';
    res.json({
      chatId,
      history: ragService.getHistory(chatId),
      max_turns: ragService.maxHistoryTurns,
      debug_trace: ragService.getDebugTrace(chatId)
    });
  } catch (error) {
    console.error('Error in /api/rag/test/history:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/test/history:
 *   delete:
 *     summary: Clear conversation history
 *     description: Clear the conversation history for query rewriting
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: History cleared
 */
router.delete('/test/history', requireDebugRoutes, async (req, res) => {
  try {
    const chatId = normalizeOptionalString(req.query.chatId) || 'default';
    ragService.clearHistoryForChat(chatId);
    res.json({ success: true, chatId, message: 'Conversation history cleared' });
  } catch (error) {
    console.error('Error in /api/rag/test/history:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/rag/test/search:
 *   post:
 *     summary: Test search with debug info
 *     description: Test search and return debug info about retrieval
 *     tags:
 *       - RAG
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               query:
 *                 type: string
 *                 example: "invoice"
 *     responses:
 *       200:
 *         description: Search results with debug info
 */
router.post('/test/search', requireDebugRoutes, async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const startTime = Date.now();
    const results = await ragService.search(query);
    const searchTime = Date.now() - startTime;
    
    res.json({
      query,
      results_count: results.length,
      search_time_ms: searchTime,
      results: results.slice(0, 10) // Limit to first 10 for response size
    });
  } catch (error) {
    console.error('Error in /api/rag/test/search:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

module.exports = router;
