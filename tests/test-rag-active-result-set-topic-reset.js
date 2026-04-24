const assert = require('assert');
const AIServiceFactory = require('../services/aiServiceFactory');
const ragService = require('../services/ragService');

async function run() {
  const originalGetService = AIServiceFactory.getService;
  const originalGetClient = ragService._getClient;
  const originalTurnIntentV2Enabled = ragService.turnIntentV2Enabled;
  let contextCalls = 0;

  try {
    ragService.chatState.clear();
    ragService.turnIntentV2Enabled = true;

    ragService._getClient = async () => ({
      post: async (_url, body) => {
        contextCalls += 1;
        const query = body.question;
        return {
          data: {
            context: 'context',
            sources: [
              {
                doc_id: contextCalls,
                title: query.includes('contract') ? 'Contract 1' : 'Rechnung 1',
                correspondent: 'Sender',
                date: '2026-04-01',
                snippet: query,
                tags: query.includes('contract') ? 'contract' : 'Rechnung'
              }
            ]
          }
        };
      }
    });

    AIServiceFactory.getService = () => ({
      generateText: async (prompt, options = {}) => {
        if (options.responseFormat && prompt.includes('Return JSON only in this shape')) {
          if (prompt.includes('contracts')) {
            return JSON.stringify({ queries: ['contracts'], filters: {} });
          }
          return JSON.stringify({ queries: ['Rechnung'], filters: {} });
        }
        if (options.responseFormat && prompt.includes('Return JSON only with this exact schema')) {
          return JSON.stringify({
            answer: 'ok [1]',
            citations: [1],
            needs_deeper_evidence: false,
            required_sources: [],
            reason: 'ok',
            confidence: 'high'
          });
        }
        return { text: 'ok [1]', content: 'ok [1]', reasoningContent: '' };
      }
    });

    await ragService.askQuestion('What documents do I have that are tagged with Rechnung?', {
      chatId: 'topic-reset-chat',
      debug: true
    });
    const secondResult = await ragService.askQuestion('Now show me contracts from last year', {
      chatId: 'topic-reset-chat',
      debug: true
    });

    assert.strictEqual(contextCalls, 2, 'Explicit topic shift should trigger a new retrieval');
    const intentEntry = secondResult.debug_trace.find((entry) => entry.stage === 'turn_intent');
    assert.strictEqual(intentEntry.intent, 'new_search');

    console.log('✅ test-rag-active-result-set-topic-reset passed');
  } finally {
    AIServiceFactory.getService = originalGetService;
    ragService._getClient = originalGetClient;
    ragService.turnIntentV2Enabled = originalTurnIntentV2Enabled;
    ragService.chatState.clear();
  }
}

run().catch((error) => {
  console.error('❌ test-rag-active-result-set-topic-reset failed:', error);
  process.exit(1);
});
