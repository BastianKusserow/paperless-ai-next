const assert = require('assert');
const AIServiceFactory = require('../services/aiServiceFactory');
const ragService = require('../services/ragService');

async function run() {
  const originalGetService = AIServiceFactory.getService;
  const originalGetClient = ragService._getClient;
  let contextCalls = 0;

  try {
    ragService.chatState.clear();

    ragService._getClient = async () => ({
      post: async (_url, body) => {
        contextCalls += 1;
        return {
          data: {
            context: 'context',
            sources: [
              {
                doc_id: 101,
                title: 'Rechnung 101',
                correspondent: 'ZWW',
                date: '2026-04-01',
                snippet: 'Invoice 101 is tagged Rechnung and paid.',
                tags: 'Rechnung,paid'
              },
              {
                doc_id: 102,
                title: 'Rechnung 102',
                correspondent: 'ZWW',
                date: '2026-05-01',
                snippet: 'Invoice 102 is tagged Rechnung.',
                tags: 'Rechnung'
              }
            ]
          }
        };
      }
    });

    AIServiceFactory.getService = () => ({
      generateText: async (prompt, options = {}) => {
        if (options.responseFormat && prompt.includes('Return JSON only in this shape')) {
          return JSON.stringify({ queries: ['Rechnung'], filters: {} });
        }
        if (options.responseFormat && prompt.includes('Return JSON only with this exact schema')) {
          return JSON.stringify({
            answer: 'Rechnung 101 is paid. [1]',
            citations: [1],
            needs_deeper_evidence: false,
            required_sources: [],
            reason: 'Snippet is sufficient',
            confidence: 'high'
          });
        }
        return {
          text: 'Rechnung 101 is paid. [1]',
          content: 'Rechnung 101 is paid. [1]',
          reasoningContent: ''
        };
      }
    });

    await ragService.askQuestion('What documents do I have that are tagged with Rechnung?', {
      chatId: 'reuse-chat',
      debug: true
    });
    const secondResult = await ragService.askQuestion('Which of them are already paid?', {
      chatId: 'reuse-chat',
      debug: true
    });

    assert.strictEqual(contextCalls, 1, 'Follow-up question should reuse active result set instead of re-retrieving');
    const retrievalEntry = secondResult.debug_trace.find((entry) => entry.stage === 'retrieval');
    assert.strictEqual(retrievalEntry.source_origin, 'active_result_set');

    console.log('✅ test-rag-active-result-set-reuse passed');
  } finally {
    AIServiceFactory.getService = originalGetService;
    ragService._getClient = originalGetClient;
    ragService.chatState.clear();
  }
}

run().catch((error) => {
  console.error('❌ test-rag-active-result-set-reuse failed:', error);
  process.exit(1);
});
