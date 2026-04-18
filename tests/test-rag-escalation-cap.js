const assert = require('assert');
const AIServiceFactory = require('../services/aiServiceFactory');
const ragService = require('../services/ragService');
const paperlessService = require('../services/paperlessService');

async function run() {
  const originalGetService = AIServiceFactory.getService;
  const originalGetClient = ragService._getClient;
  const originalGetDocumentContent = paperlessService.getDocumentContent;
  const originalCap = ragService.maxEscalationDocuments;
  const fetched = [];

  try {
    ragService.chatState.clear();
    ragService.maxEscalationDocuments = 2;
    paperlessService.getDocumentContent = async (docId) => {
      fetched.push(docId);
      return `full ${docId}`;
    };
    ragService._getClient = async () => ({
      post: async () => ({
        data: {
          context: 'context',
          sources: [1, 2, 3, 4].map((id) => ({
            doc_id: id,
            title: `Doc ${id}`,
            correspondent: 'Sender',
            date: '2026-04-01',
            snippet: `Snippet ${id}`,
            tags: 'invoice'
          }))
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
            citations: [1, 2, 3, 4],
            needs_deeper_evidence: true,
            required_sources: [1, 2, 3, 4],
            reason: 'Need all docs',
            confidence: 'low'
          });
        }
        return { text: 'Final deep answer', content: 'Final deep answer', reasoningContent: '' };
      }
    });

    await ragService.askQuestion('Compare all docs exactly', { chatId: 'cap-chat', debug: true });
    assert.deepStrictEqual(fetched, [1, 2], 'Should cap full-document fetching to maxEscalationDocuments');

    console.log('✅ test-rag-escalation-cap passed');
  } finally {
    AIServiceFactory.getService = originalGetService;
    ragService._getClient = originalGetClient;
    paperlessService.getDocumentContent = originalGetDocumentContent;
    ragService.maxEscalationDocuments = originalCap;
    ragService.chatState.clear();
  }
}

run().catch((error) => {
  console.error('❌ test-rag-escalation-cap failed:', error);
  process.exit(1);
});
