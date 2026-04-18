const assert = require('assert');
const AIServiceFactory = require('../services/aiServiceFactory');
const ragService = require('../services/ragService');

async function run() {
  const originalGetService = AIServiceFactory.getService;
  const originalGetClient = ragService._getClient;

  try {
    ragService.chatState.clear();
    ragService._getClient = async () => ({
      post: async () => ({
        data: {
          context: 'context',
          sources: [
            { doc_id: 9, title: 'Doc 9', correspondent: 'Sender', date: '2026-04-01', snippet: 'Snippet', tags: 'invoice' }
          ]
        }
      })
    });

    AIServiceFactory.getService = () => ({
      generateText: async (prompt, options = {}) => {
        if (options.responseFormat && prompt.includes('Return JSON only in this shape')) {
          return JSON.stringify({ queries: ['Doc 9'], filters: {} });
        }
        if (options.responseFormat && prompt.includes('Return JSON only with this exact schema')) {
          return JSON.stringify({
            answer: 'Snippet says enough. [1]',
            citations: [1],
            needs_deeper_evidence: false,
            required_sources: [],
            reason: 'Enough evidence',
            confidence: 'high'
          });
        }
        return { text: 'Snippet says enough. [1]', content: 'Snippet says enough. [1]', reasoningContent: '' };
      }
    });

    const result = await ragService.askQuestion('What does doc 9 say?', { chatId: 'debug-chat', debug: true });
    const stages = result.debug_trace.map((entry) => entry.stage);

    assert.ok(stages.includes('rewrite'));
    assert.ok(stages.includes('rewrite_result'));
    assert.ok(stages.includes('retrieval'));
    assert.ok(stages.includes('answer_planner'));
    assert.ok(stages.includes('escalation'));
    assert.ok(stages.includes('final_answer_prompt'));
    assert.ok(stages.includes('final_answer_response'));

    console.log('✅ test-rag-debug-trace-shape passed');
  } finally {
    AIServiceFactory.getService = originalGetService;
    ragService._getClient = originalGetClient;
    ragService.chatState.clear();
  }
}

run().catch((error) => {
  console.error('❌ test-rag-debug-trace-shape failed:', error);
  process.exit(1);
});
