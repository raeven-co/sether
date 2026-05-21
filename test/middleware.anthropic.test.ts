import { describe, it, expect } from 'vitest';
import { wrapAnthropic } from '../src/middleware/anthropic.js';
import { basicDetectors } from '../src/detectors/basic.js';
import { MemoryVault } from '../src/vault/memory.js';

function makeFakeAnthropic() {
  let seen: unknown = null;
  const client = {
    messages: {
      create: async (req: unknown): Promise<unknown> => {
        seen = req;
        const r = req as { messages: Array<{ role: string; content: unknown }> };
        const last = r.messages[r.messages.length - 1];
        const text = typeof last?.content === 'string' ? last.content : '';
        return {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: `Echo: ${text}` }],
          stop_reason: 'end_turn',
        };
      },
    },
  };
  return { client, getSeen: () => seen };
}

describe('wrapAnthropic', () => {
  it('redacts user message content + restores response content blocks', async () => {
    const vault = new MemoryVault();
    const { client, getSeen } = makeFakeAnthropic();
    const wrapped = wrapAnthropic(client, { detectors: basicDetectors, vault });

    const reply = (await wrapped.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: 'Reach out to bob@example.org about SSN 123-45-6789' },
      ],
    })) as { content: Array<{ type: string; text: string }> };

    const seen = getSeen() as { messages: Array<{ content: string }> };
    expect(seen.messages[0]?.content).not.toContain('bob@example.org');
    expect(seen.messages[0]?.content).not.toContain('123-45-6789');
    expect(seen.messages[0]?.content).toMatch(/<EMAIL_/);
    expect(seen.messages[0]?.content).toMatch(/<SSN_/);

    expect(reply.content[0]?.text).toContain('bob@example.org');
    expect(reply.content[0]?.text).toContain('123-45-6789');
  });

  it('redacts top-level `system` prompt as a string', async () => {
    const vault = new MemoryVault();
    const { client, getSeen } = makeFakeAnthropic();
    const wrapped = wrapAnthropic(client, { detectors: basicDetectors, vault });

    await wrapped.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      system: 'Customer of record: alice@example.com',
      messages: [{ role: 'user', content: 'Anything in my file?' }],
    });

    const seen = getSeen() as { system: string };
    expect(seen.system).not.toContain('alice@example.com');
    expect(seen.system).toMatch(/<EMAIL_/);
  });

  it('handles content as an array of text blocks (long-form prompts)', async () => {
    const vault = new MemoryVault();
    const { client, getSeen } = makeFakeAnthropic();
    const wrapped = wrapAnthropic(client, { detectors: basicDetectors, vault });

    await wrapped.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'First mention of charlie@example.io' },
            { type: 'text', text: 'and a UK number +44 20 7946 0958.' },
          ],
        },
      ],
    });

    const seen = getSeen() as { messages: Array<{ content: Array<{ text: string }> }> };
    const blocks = seen.messages[0]!.content;
    expect(blocks[0]?.text).not.toContain('charlie@example.io');
    expect(blocks[0]?.text).toMatch(/<EMAIL_/);
    expect(blocks[1]?.text).not.toContain('+44 20 7946 0958');
    expect(blocks[1]?.text).toMatch(/<PHONE_/);
  });
});
