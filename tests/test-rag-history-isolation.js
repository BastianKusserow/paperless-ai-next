const assert = require('assert');
const AIServiceFactory = require('../services/aiServiceFactory');
const ragService = require('../services/ragService');

async function run() {
  const originalGetService = AIServiceFactory.getService;

  try {
    ragService.chatState.clear();

    AIServiceFactory.getService = () => ({
      generateText: async (prompt, options = {}) => {
        const textToInspect = Array.isArray(options.messages)
          ? options.messages.map((message) => message.content).join('\n')
          : prompt;
        return JSON.stringify({
          queries: [textToInspect.includes('invoice-a') ? 'from-a' : 'from-b'],
          filters: {}
        });
      }
    });

    ragService.addToHistoryForChat('chat-a', 'user', 'invoice-a');
    ragService.addToHistoryForChat('chat-a', 'assistant', 'answer-a');
    ragService.addToHistoryForChat('chat-b', 'user', 'contract-b');
    ragService.addToHistoryForChat('chat-b', 'assistant', 'answer-b');

    const resultA = await ragService.rewriteQuery('follow up', {}, { chatId: 'chat-a' });
    const resultB = await ragService.rewriteQuery('follow up', {}, { chatId: 'chat-b' });

    assert.deepStrictEqual(resultA.rewritten_queries, ['from-a']);
    assert.deepStrictEqual(resultB.rewritten_queries, ['from-b']);
    assert.strictEqual(ragService.getHistory('chat-a').length, 2);
    assert.strictEqual(ragService.getHistory('chat-b').length, 2);

    console.log('✅ test-rag-history-isolation passed');
  } finally {
    AIServiceFactory.getService = originalGetService;
    ragService.chatState.clear();
  }
}

run().catch((error) => {
  console.error('❌ test-rag-history-isolation failed:', error);
  process.exit(1);
});
