const assert = require('assert');
const AIServiceFactory = require('../services/aiServiceFactory');
const ragService = require('../services/ragService');
const paperlessService = require('../services/paperlessService');

async function run() {
  const originalGetService = AIServiceFactory.getService;
  const originalGetClient = ragService._getClient;
  const originalGetDocumentContent = paperlessService.getDocumentContent;
  const fetched = [];

  try {
    ragService.chatState.clear();
    paperlessService.getDocumentContent = async (docId) => {
      fetched.push(docId);
      return `Full invoice content ${docId}`;
    };

    ragService._getClient = async () => ({
      post: async () => ({
        data: {
          context: 'context',
          sources: [
            { doc_id: 1, title: 'Rechnung A', correspondent: 'ZWW', date: '2026-04-01', snippet: 'Invoice A amount 250 EUR', tags: 'Rechnung,paid' },
            { doc_id: 2, title: 'Rechnung B', correspondent: 'ZWW', date: '2026-05-01', snippet: 'Invoice B amount 250 EUR', tags: 'Rechnung' },
            { doc_id: 3, title: 'Rechnung C', correspondent: 'ZWW', date: '2026-06-01', snippet: 'Invoice C amount 250 EUR', tags: 'Rechnung' }
          ]
        }
      })
    });

    AIServiceFactory.getService = () => ({
      generateText: async (prompt, options = {}) => {
        if (options.responseFormat && prompt.includes('Return JSON only in this shape')) {
          return JSON.stringify({ queries: ['unpaid invoices'], filters: {} });
        }

        if (options.responseFormat && prompt.includes('Return JSON only with this exact schema')) {
          return JSON.stringify({
            answer: '',
            citations: [],
            needs_deeper_evidence: false,
            required_sources: [],
            reason: 'planner underestimated the need',
            confidence: 'low'
          });
        }

        return {
          text: 'You still have to pay invoices B and C. [2] [3]',
          content: 'You still have to pay invoices B and C. [2] [3]',
          reasoningContent: ''
        };
      }
    });

    const result = await ragService.askQuestion('What do I still have to pay?', {
      chatId: 'payment-heuristic-chat',
      debug: true
    });

    assert.match(result.answer, /still have to pay/i);
    assert.deepStrictEqual(fetched, [2, 3], 'Should fetch unpaid invoices based on payment heuristic');

    console.log('✅ test-rag-payment-heuristic-escalation passed');
  } finally {
    AIServiceFactory.getService = originalGetService;
    ragService._getClient = originalGetClient;
    paperlessService.getDocumentContent = originalGetDocumentContent;
    ragService.chatState.clear();
  }
}

run().catch((error) => {
  console.error('❌ test-rag-payment-heuristic-escalation failed:', error);
  process.exit(1);
});
