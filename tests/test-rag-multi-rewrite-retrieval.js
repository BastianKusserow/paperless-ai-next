const assert = require('assert');
const AIServiceFactory = require('../services/aiServiceFactory');
const ragService = require('../services/ragService');

async function run() {
  const originalGetService = AIServiceFactory.getService;
  const originalGetClient = ragService._getClient;
  const originalMaxSourcesPerQuery = ragService.maxSourcesPerQuery;
  const originalMaxRetrievalSources = ragService.maxRetrievalSources;
  const contextQueries = [];

  try {
    ragService.chatState.clear();
    ragService.maxSourcesPerQuery = 5;
    ragService.maxRetrievalSources = 8;

    ragService._getClient = async () => ({
      post: async (_url, body) => {
        contextQueries.push(body.question);
        if (body.question === 'query-a') {
          return {
            data: {
              context: 'context-a',
              sources: [
                { doc_id: 1, title: 'Doc 1', correspondent: 'A', date: '2026-01-01', snippet: 'from query a', tags: 'one' },
                { doc_id: 2, title: 'Doc 2', correspondent: 'B', date: '2026-01-02', snippet: 'shared', tags: 'two' }
              ]
            }
          };
        }

        return {
          data: {
            context: 'context-b',
            sources: [
              { doc_id: 2, title: 'Doc 2', correspondent: 'B', date: '2026-01-02', snippet: 'shared duplicate', tags: 'two' },
              { doc_id: 3, title: 'Doc 3', correspondent: 'C', date: '2026-01-03', snippet: 'from query b', tags: 'three' }
            ]
          }
        };
      }
    });

    AIServiceFactory.getService = () => ({
      generateText: async (prompt, options = {}) => {
        if (options.responseFormat && prompt.includes('Return JSON only in this shape')) {
          return JSON.stringify({ queries: ['query-a', 'query-b'], filters: {} });
        }

        if (options.responseFormat && prompt.includes('Return JSON only with this exact schema')) {
          return JSON.stringify({
            answer: 'Lightweight answer [1]',
            citations: [1],
            needs_deeper_evidence: false,
            required_sources: [],
            reason: 'enough',
            confidence: 'high'
          });
        }

        return {
          text: 'Lightweight answer [1]',
          content: 'Lightweight answer [1]',
          reasoningContent: ''
        };
      }
    });

    const result = await ragService.askQuestion('Show me matching docs', {
      chatId: 'multi-rewrite-chat',
      debug: true
    });

    assert.deepStrictEqual(contextQueries, ['query-a', 'query-b'], 'Should request context for every rewritten query');
    assert.strictEqual(result.sources.length, 3, 'Should merge and dedupe sources from all rewritten queries');
    assert.deepStrictEqual(result.sources.map((source) => source.doc_id), [1, 2, 3]);
    const retrievalEntry = result.debug_trace.find((entry) => entry.stage === 'retrieval');
    assert.ok(retrievalEntry);
    assert.deepStrictEqual(retrievalEntry.retrieval_queries, ['query-a', 'query-b']);

    console.log('✅ test-rag-multi-rewrite-retrieval passed');
  } finally {
    AIServiceFactory.getService = originalGetService;
    ragService._getClient = originalGetClient;
    ragService.maxSourcesPerQuery = originalMaxSourcesPerQuery;
    ragService.maxRetrievalSources = originalMaxRetrievalSources;
    ragService.chatState.clear();
  }
}

run().catch((error) => {
  console.error('❌ test-rag-multi-rewrite-retrieval failed:', error);
  process.exit(1);
});
