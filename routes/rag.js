// routes/rag.js
const express = require('express');
const router = express.Router();
const ragService = require('../services/ragService');

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
 *             properties:
 *               question:
 *                 type: string
 *                 example: "Which invoices are overdue?"
 *     responses:
 *       200:
 *         description: Answer generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Missing required question
 *       500:
 *         description: Internal server error
 */
router.post('/ask', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }
    
    const result = await ragService.askQuestion(question);
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
 * /api/rag/test/query-rewrite:
 *   post:
 *     summary: Test query rewriting
 *     description: Test the query rewriting feature with conversation history
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
 */
router.post('/test/query-rewrite', async (req, res) => {
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
router.get('/test/history', async (req, res) => {
  try {
    res.json({
      history: ragService.conversationHistory,
      max_messages: ragService.maxHistoryMessages
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
router.delete('/test/history', async (req, res) => {
  try {
    ragService.clearHistory();
    res.json({ success: true, message: 'Conversation history cleared' });
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
router.post('/test/search', async (req, res) => {
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
