const assert = require('assert');
const AIServiceFactory = require('../services/aiServiceFactory');
const ragService = require('../services/ragService');
const paperlessService = require('../services/paperlessService');

async function run() {
  const originalGetService = AIServiceFactory.getService;
  const originalGetClient = ragService._getClient;
  const originalGetDocumentContent = paperlessService.getDocumentContent;
  let fullFetchCount = 0;

  try {
    ragService.chatState.clear();
    paperlessService.getDocumentContent = async () => {
      fullFetchCount += 1;
      return 'should not be fetched';
    };

    ragService._getClient = async () => ({
      post: async (_url, body) => ({
        data: {
          context: 'lightweight context',
          sources: [
            {
              doc_id: 11,
              title: 'Invoice 11',
              correspondent: 'ACME',
              date: '2026-04-10',
              tags: 'invoice,paid',
              snippet: 'Invoice 11 is marked as paid.'
            }
          ]
        }
      })
    });

    AIServiceFactory.getService = () => ({
      generateText: async (prompt, options = {}) => {
        if (options.responseFormat && prompt.includes('Return JSON only in this shape')) {
          return JSON.stringify({ queries: ['Invoice 11'], filters: {} });
        }

        if (options.responseFormat && prompt.includes('Return JSON only with this exact schema')) {
          return JSON.stringify({
            answer: 'Invoice 11 is already paid. [1]',
            citations: [1],
            needs_deeper_evidence: false,
            required_sources: [],
            reason: 'Snippet is sufficient',
            confidence: 'high'
          });
        }

        return {
          text: 'Invoice 11 is already paid. [1]',
          content: 'Invoice 11 is already paid. [1]',
          reasoningContent: '',
          providerDiagnostics: { finishReason: 'stop' }
        };
      }
    });

    const result = await ragService.askQuestion('Is invoice 11 paid?', {
      chatId: 'lightweight-chat',
      debug: true
    });

    assert.match(result.answer, /already paid/i);
    assert.strictEqual(fullFetchCount, 0, 'Should not fetch full documents for lightweight answer');
    assert.ok(Array.isArray(result.debug_trace), 'Should expose debug trace');
    assert.ok(result.debug_trace.some((entry) => entry.stage === 'answer_planner'));

    console.log('✅ test-rag-lightweight-answer-no-escalation passed');
  } finally {
    AIServiceFactory.getService = originalGetService;
    ragService._getClient = originalGetClient;
    paperlessService.getDocumentContent = originalGetDocumentContent;
    ragService.chatState.clear();
  }
}

run().catch((error) => {
  console.error('❌ test-rag-lightweight-answer-no-escalation failed:', error);
  process.exit(1);
});
