const assert = require('assert');
const AIServiceFactory = require('../services/aiServiceFactory');
const ragService = require('../services/ragService');

async function run() {
  const originalGetService = AIServiceFactory.getService;
  const originalGetClient = ragService._getClient;
  const originalTurnIntentV2Enabled = ragService.turnIntentV2Enabled;
  const originalThresholdLow = ragService.turnIntentThresholdLow;
  const originalThresholdHigh = ragService.turnIntentThresholdHigh;
  let contextCalls = 0;

  try {
    ragService.chatState.clear();
    ragService.turnIntentV2Enabled = true;
    ragService.turnIntentThresholdLow = 0.3;
    ragService.turnIntentThresholdHigh = 0.7;

    ragService._getClient = async () => ({
      post: async (_url, body) => {
        contextCalls += 1;
        const query = String(body.question || '');
          if (/open invoices/i.test(query)) {
            return {
              data: {
                context: 'context-2',
                sources: [
                  {
                    doc_id: 202,
                    title: 'Invoice 202',
                    correspondent: 'Power Utility',
                    date: '2026-05-11',
                    snippet: 'Invoice 202 has amount 90 EUR and remains open.',
                    tags: 'invoice,open'
                  }
                ]
              }
            };
          }

          if (/invoice|rechnung/i.test(query)) {
            return {
              data: {
                context: 'context-1',
              sources: [
                {
                  doc_id: 201,
                  title: 'Invoice 201',
                  correspondent: 'Power Utility',
                  date: '2026-04-12',
                  snippet: 'Invoice 201 has amount 45 EUR and is marked paid.',
                  tags: 'invoice,paid'
                }
              ]
            }
          };
        }

        return {
          data: {
            context: 'context-generic',
            sources: [
              {
                doc_id: 203,
                title: 'Notice 203',
                correspondent: 'Power Utility',
                date: '2026-05-13',
                snippet: 'General notice from utility provider.',
                tags: 'notice'
              }
            ]
          }
        };
      }
    });

    AIServiceFactory.getService = () => ({
      generateText: async (prompt, options = {}) => {
        if (options.responseFormat && prompt.includes('Return JSON only in this shape')) {
          if (prompt.includes('open invoices')) {
            return JSON.stringify({ queries: ['open invoices'], filters: {} });
          }
          return JSON.stringify({ queries: ['invoice'], filters: {} });
        }

        if (options.responseFormat && prompt.includes('Return JSON only with this exact schema')) {
          return JSON.stringify({
            answer: 'Invoice 202 is still open. [2]',
            citations: [2],
            needs_deeper_evidence: false,
            required_sources: [],
            reason: 'snippet evidence',
            confidence: 'medium'
          });
        }

        return {
          text: 'Invoice 202 is still open. [2]',
          content: 'Invoice 202 is still open. [2]',
          reasoningContent: ''
        };
      }
    });

    await ragService.askQuestion('List invoices', { chatId: 'hybrid-chat', debug: true });

    const secondQuestion = 'Show me open invoices from power utility this year';
    const probe = ragService.classifyTurnIntent(secondQuestion, 'hybrid-chat');
    assert.strictEqual(typeof probe.reuse_score, 'number');
    ragService.turnIntentThresholdLow = Math.max(0, probe.reuse_score - 0.05);
    ragService.turnIntentThresholdHigh = Math.min(1, probe.reuse_score + 0.05);

    const secondResult = await ragService.askQuestion(secondQuestion, {
      chatId: 'hybrid-chat',
      debug: true
    });

    assert.ok(contextCalls >= 2, 'Hybrid intent should trigger fresh retrieval for follow-up');
    const intentEntry = secondResult.debug_trace.find((entry) => entry.stage === 'turn_intent');
    assert.ok(intentEntry, 'Expected turn_intent debug entry');
    assert.strictEqual(intentEntry.intent, 'reuse_plus_refresh');

    const retrievalEntry = secondResult.debug_trace.find((entry) => entry.stage === 'retrieval');
    assert.ok(retrievalEntry, 'Expected retrieval debug entry');
    assert.strictEqual(retrievalEntry.source_origin, 'hybrid_reuse_plus_refresh');

    const sourceIds = secondResult.sources.map((source) => source.doc_id);
    assert.ok(sourceIds.includes(201), 'Hybrid result should include active-set source');
    assert.ok(sourceIds.includes(202), 'Hybrid result should include freshly retrieved source');

    console.log('✅ test-rag-turn-intent-hybrid passed');
  } finally {
    AIServiceFactory.getService = originalGetService;
    ragService._getClient = originalGetClient;
    ragService.turnIntentV2Enabled = originalTurnIntentV2Enabled;
    ragService.turnIntentThresholdLow = originalThresholdLow;
    ragService.turnIntentThresholdHigh = originalThresholdHigh;
    ragService.chatState.clear();
  }
}

run().catch((error) => {
  console.error('❌ test-rag-turn-intent-hybrid failed:', error);
  process.exit(1);
});
