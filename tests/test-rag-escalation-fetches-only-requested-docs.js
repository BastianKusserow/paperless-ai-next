const assert = require('assert');
const AIServiceFactory = require('../services/aiServiceFactory');
const ragService = require('../services/ragService');
const paperlessService = require('../services/paperlessService');

async function run() {
  const originalGetService = AIServiceFactory.getService;
  const originalGetClient = ragService._getClient;
  const originalGetDocumentContent = paperlessService.getDocumentContent;
  const fetchedDocIds = [];

  try {
    ragService.chatState.clear();
    ragService.documentContentCache.clear();
    paperlessService.getDocumentContent = async (docId) => {
      fetchedDocIds.push(docId);
      return `Full content for ${docId}`;
    };

    ragService._getClient = async () => ({
      post: async () => ({
        data: {
          context: 'context',
          sources: [
            { doc_id: 1, title: 'Doc 1', correspondent: 'A', date: '2026-01-01', snippet: 'A', tags: 'one' },
            { doc_id: 2, title: 'Doc 2', correspondent: 'B', date: '2026-01-02', snippet: 'B', tags: 'two' },
            { doc_id: 3, title: 'Doc 3', correspondent: 'C', date: '2026-01-03', snippet: 'C', tags: 'three' }
          ]
        }
      })
    });

    AIServiceFactory.getService = () => ({
      generateText: async (prompt, options = {}) => {
        if (options.responseFormat && prompt.includes('Return JSON only in this shape')) {
          return JSON.stringify({ queries: ['Doc'], filters: {} });
        }

        if (options.responseFormat && prompt.includes('Return JSON only with this exact schema')) {
          return JSON.stringify({
            answer: '',
            citations: [2],
            needs_deeper_evidence: true,
            required_sources: [2],
            reason: 'Need exact wording',
            confidence: 'medium'
          });
        }

        return {
          text: 'Final answer from full document [2]',
          content: 'Final answer from full document [2]',
          reasoningContent: ''
        };
      }
    });

    const result = await ragService.askQuestion('What is the exact wording?', {
      chatId: 'escalation-chat',
      debug: true
    });

    assert.strictEqual(result.answer, 'Final answer from full document [2]');
    assert.deepStrictEqual(fetchedDocIds, [2], 'Should fetch only the requested document');
    const escalationEntry = result.debug_trace.find((entry) => entry.stage === 'escalation');
    assert.ok(escalationEntry);
    assert.deepStrictEqual(escalationEntry.requested_indexes, [2]);

    console.log('✅ test-rag-escalation-fetches-only-requested-docs passed');
  } finally {
    AIServiceFactory.getService = originalGetService;
    ragService._getClient = originalGetClient;
    paperlessService.getDocumentContent = originalGetDocumentContent;
    ragService.chatState.clear();
    ragService.documentContentCache.clear();
  }
}

run().catch((error) => {
  console.error('❌ test-rag-escalation-fetches-only-requested-docs failed:', error);
  process.exit(1);
});
