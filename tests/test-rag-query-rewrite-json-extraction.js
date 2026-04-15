const assert = require('assert');
const AIServiceFactory = require('../services/aiServiceFactory');
const ragService = require('../services/ragService');
const { extractJsonPayload } = require('../services/serviceUtils');

async function run() {
  const originalGetService = AIServiceFactory.getService;
  const originalHistory = [...ragService.conversationHistory];

  try {
    const wrappedJson = [
      'Thinking Process:',
      '',
      '1. Analyze the request.',
      '',
      '```json',
      '{"queries":["documents added"],"filters":{"from_date":"2026-03-14","to_date":"2026-04-14","correspondent":""}}',
      '```'
    ].join('\n');

    assert.strictEqual(
      extractJsonPayload(wrappedJson),
      '{"queries":["documents added"],"filters":{"from_date":"2026-03-14","to_date":"2026-04-14","correspondent":""}}',
      'Should extract JSON payload from fenced reasoning output'
    );

    AIServiceFactory.getService = () => ({
      generateText: async (_prompt, options = {}) => {
        assert.strictEqual(options.temperature, 0, 'Query rewrite should force deterministic temperature');
        assert.deepStrictEqual(options.responseFormat, { type: 'json_object' }, 'Query rewrite should request JSON output');
        return wrappedJson;
      }
    });

    ragService.clearHistory();

    const result = await ragService.rewriteQuery('What documents got added last month?');

    assert.deepStrictEqual(
      result.rewritten_queries,
      ['documents added'],
      'Should recover rewritten queries from wrapped JSON output'
    );
    assert.deepStrictEqual(
      result.filters,
      { from_date: '2026-03-14', to_date: '2026-04-14', correspondent: '' },
      'Should recover filters from wrapped JSON output'
    );

    console.log('✅ test-rag-query-rewrite-json-extraction passed');
  } finally {
    AIServiceFactory.getService = originalGetService;
    ragService.conversationHistory = originalHistory;
  }
}

run().catch(error => {
  console.error('❌ test-rag-query-rewrite-json-extraction failed:', error);
  process.exit(1);
});
