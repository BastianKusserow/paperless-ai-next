const assert = require('assert');
const customService = require('../services/customService');

async function run() {
  const originalInitialize = customService.initialize;
  const originalClient = customService.client;

  try {
    customService.initialize = function initializeStub() {
      this.client = {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: '',
                    reasoning_content: 'Model reasoned but returned no visible content.'
                  },
                  finish_reason: 'stop'
                }
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5 }
            })
          }
        }
      };
    };

    const result = await customService.generateText('test prompt', {
      returnMessageParts: true,
      enableThinking: true
    });

    assert.strictEqual(result.text, '');
    assert.match(result.reasoningContent, /reasoned/i);
    assert.strictEqual(result.providerDiagnostics.error, 'Invalid API response structure');

    console.log('✅ test-rag-custom-provider-empty-response passed');
  } finally {
    customService.initialize = originalInitialize;
    customService.client = originalClient;
  }
}

run().catch((error) => {
  console.error('❌ test-rag-custom-provider-empty-response failed:', error);
  process.exit(1);
});
