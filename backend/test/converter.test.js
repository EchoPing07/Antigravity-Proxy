import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_PASSWORD = 'test-admin';
process.env.JWT_SECRET = 'test-jwt-secret';

const { initDatabase } = await import('../src/db/index.js');
initDatabase();

const {
  convertOpenAIToAntigravity,
  convertAnthropicToAntigravity,
  convertSSEChunk,
  convertResponse,
  extractUsageFromSSE,
  getModelsList,
  preprocessAnthropicRequest
} = await import('../src/services/converter.js');

test('getModelsList returns OpenAI-style list', () => {
  const list = getModelsList();
  assert.equal(list.object, 'list');
  assert.ok(Array.isArray(list.data));
  assert.ok(list.data.length > 0);
  assert.ok(list.data.every((m) => typeof m.id === 'string' && m.object === 'model'));
});

test('convertOpenAIToAntigravity converts basic chat', () => {
  const req = {
    model: 'gemini-2.5-flash',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' }
    ],
    temperature: 0.7,
    max_tokens: 123,
    stream: false
  };

  const out = convertOpenAIToAntigravity(req, 'proj-1', 'sess-1');
  assert.equal(out.project, 'proj-1');
  assert.equal(out.model, 'gemini-2.5-flash');
  assert.match(out.requestId, /^agent-[0-9a-f-]+$/);
  assert.equal(out.request.sessionId, 'sess-1');
  assert.ok(out.request.systemInstruction);
  assert.equal(out.request.systemInstruction.role, 'user');
  assert.equal(out.request.systemInstruction.parts?.[0]?.text, 'You are helpful.');
  assert.ok(Array.isArray(out.request.contents));
  assert.equal(out.request.contents.length, 1);
  assert.equal(out.request.contents[0].role, 'user');
});

test('convertAnthropicToAntigravity converts basic message with thinking', () => {
  const req = {
    model: 'claude-opus-4-5-thinking',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    max_tokens: 256,
    stream: false,
    thinking: { type: 'enabled', budget_tokens: 1024 }
  };

  const out = convertAnthropicToAntigravity(req, 'proj-2', 'sess-2');
  assert.equal(out.project, 'proj-2');
  assert.equal(out.model, 'claude-opus-4-5-thinking');
  assert.match(out.requestId, /^agent-[0-9a-f-]+$/);
  assert.equal(out.request.sessionId, 'sess-2');
  assert.equal(out.request.generationConfig.thinkingConfig?.includeThoughts, true);
  assert.equal(out.request.generationConfig.thinkingConfig?.thinkingBudget, 1024);
});

test('convertSSEChunk emits OpenAI chunks including reasoning_content when enabled', () => {
  const antigravityData = JSON.stringify({
    response: {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: 't1' },
              { text: 'hello' }
            ]
          },
          finishReason: 'STOP'
        }
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3, thoughtsTokenCount: 4 }
    }
  });

  const chunks = convertSSEChunk(antigravityData, 'req-1', 'gemini-2.5-flash', true);
  assert.ok(Array.isArray(chunks));
  assert.ok(chunks.length >= 1);
  // at least one chunk should carry reasoning_content or content
  assert.ok(
    chunks.some((c) => c?.choices?.[0]?.delta?.reasoning_content === 't1') ||
      chunks.some((c) => c?.choices?.[0]?.delta?.content)
  );
  // final chunk with finish_reason should exist
  assert.ok(chunks.some((c) => c?.choices?.[0]?.finish_reason));
});

test('convertResponse returns OpenAI non-stream response', () => {
  const antigravityResponse = {
    response: {
      candidates: [
        {
          content: {
            parts: [{ text: 'ok' }]
          },
          finishReason: 'STOP'
        }
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 }
    }
  };

  const out = convertResponse(antigravityResponse, 'req-2', 'gemini-2.5-flash', false);
  assert.equal(out.object, 'chat.completion');
  assert.equal(out.id, 'chatcmpl-req-2');
  assert.equal(out.choices?.[0]?.message?.content, 'ok');
  assert.equal(out.usage.total_tokens, 3);
});

test('extractUsageFromSSE extracts usageMetadata', () => {
  const antigravityData = JSON.stringify({
    response: {
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3, thoughtsTokenCount: 4 }
    }
  });
  assert.deepEqual(extractUsageFromSSE(antigravityData), {
    promptTokens: 1,
    completionTokens: 2,
    totalTokens: 3,
    thinkingTokens: 4
  });
});

test('preprocessAnthropicRequest removes empty text blocks and avoids empty content', () => {
  const req = {
    model: 'claude-opus-4-5-thinking',
    thinking: { type: 'enabled', budget_tokens: 1024 },
    messages: [
      { role: 'user', content: [{ type: 'text', text: '' }] }
    ]
  };

  const out = preprocessAnthropicRequest(req);
  assert.ok(out);
  assert.ok(Array.isArray(out.messages));
  assert.equal(out.messages[0].content.length, 1);
  assert.equal(out.messages[0].content[0].type, 'text');
  assert.equal(out.messages[0].content[0].text, ' ');
});

