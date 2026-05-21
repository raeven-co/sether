import { describe, it, expect } from 'vitest';
import { wrapOpenAI } from '../src/middleware/openai.js';
import { basicDetectors } from '../src/detectors/basic.js';
import { MemoryVault } from '../src/vault/memory.js';

// Tiny stand-in for the OpenAI client. Records what was passed to
// `chat.completions.create` and returns a canned reply that echoes the user
// content back (so we can assert restore happens on the way out).
function makeFakeClient() {
  let seen: unknown = null;
  const client = {
    chat: {
      completions: {
        create: async (req: unknown): Promise<unknown> => {
          seen = req;
          // Echo the last user message content back as the model's reply.
          const r = req as { messages: Array<{ role: string; content: unknown }> };
          const last = r.messages[r.messages.length - 1];
          const text = typeof last?.content === 'string' ? last.content : '';
          return {
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: `You said: ${text}` },
                finish_reason: 'stop',
              },
            ],
          };
        },
      },
    },
  };
  return { client, getSeen: () => seen };
}

describe('wrapOpenAI', () => {
  it('redacts user message content before it leaves and restores response content on return', async () => {
    const vault = new MemoryVault();
    const { client, getSeen } = makeFakeClient();
    const wrapped = wrapOpenAI(client, { detectors: basicDetectors, vault });

    const completion = (await wrapped.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Email alice@example.com about order 4532-0151-1283-0366' },
      ],
    })) as { choices: Array<{ message: { content: string } }> };

    const seenReq = getSeen() as { messages: Array<{ content: string }> };
    const lastUser = seenReq.messages[1]!;
    expect(lastUser.content).not.toContain('alice@example.com');
    expect(lastUser.content).not.toContain('4532-0151-1283-0366');
    expect(lastUser.content).toMatch(/<EMAIL_/);
    expect(lastUser.content).toMatch(/<CC_/);

    const reply = completion.choices[0]?.message.content ?? '';
    expect(reply).toContain('alice@example.com');
    expect(reply).toContain('4532-0151-1283-0366');
  });

  it('handles array-of-parts content (vision-style messages)', async () => {
    const vault = new MemoryVault();
    const { client, getSeen } = makeFakeClient();
    const wrapped = wrapOpenAI(client, { detectors: basicDetectors, vault });

    await wrapped.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Customer alice@example.com asks:' },
            { type: 'image_url', image_url: { url: 'https://example.test/img.png' } },
          ],
        },
      ],
    });

    const seen = getSeen() as { messages: Array<{ content: Array<{ type: string; text?: string }> }> };
    const parts = seen.messages[0]!.content;
    expect(parts[0]?.text).not.toContain('alice@example.com');
    expect(parts[0]?.text).toMatch(/<EMAIL_/);
    // Non-text part passed through.
    expect(parts[1]?.type).toBe('image_url');
  });

  it('passes non-string / non-array content through unmodified', async () => {
    const vault = new MemoryVault();
    const { client } = makeFakeClient();
    const wrapped = wrapOpenAI(client, { detectors: basicDetectors, vault });
    // Should not throw on a request with no messages.
    await expect(wrapped.chat.completions.create({ model: 'gpt-4', messages: [] })).resolves.toBeDefined();
  });
});
