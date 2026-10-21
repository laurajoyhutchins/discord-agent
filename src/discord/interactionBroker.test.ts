import type { AnyThreadChannel } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { DiscordInteractionBroker } from './interactionBroker.js';

interface FakeInteraction {
  customId: string;
  values: string[];
  user: { id: string };
  guild: { members: { fetch: (id: string) => Promise<{ id: string }> } };
  isButton: () => boolean;
  isStringSelectMenu: () => boolean;
  deferUpdate: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
}

class FakeQuestionThread {
  readonly id = 'thread-1';
  readonly sent: Array<{ components?: Array<{ toJSON: () => { components: Array<{ custom_id: string }> } }> }> = [];
  readonly interactions: FakeInteraction[] = [];
  readonly edits: unknown[] = [];
  replyText = '';

  readonly message = {
    awaitMessageComponent: vi.fn(async () => this.interactions.shift() ?? null),
    edit: vi.fn(async (payload: unknown) => { this.edits.push(payload); }),
  };

  readonly send = vi.fn(async (payload: { components?: Array<{ toJSON: () => { components: Array<{ custom_id: string }> } }> }) => {
    this.sent.push(payload);
    return this.message;
  });

  readonly awaitMessages = vi.fn(async () => ({
    first: () => ({
      author: { id: 'authorized', bot: false },
      guild: { members: { fetch: async () => ({ id: 'authorized' }) } },
      content: this.replyText,
    }),
  }));

  channel(): AnyThreadChannel {
    return this as unknown as AnyThreadChannel;
  }

  idFor(row: number): string {
    return this.sent[0].components?.[row]?.toJSON().components[0].custom_id ?? '';
  }

  interaction(customId: string, kind: 'button' | 'select', userId = 'authorized', values: string[] = []): FakeInteraction {
    return {
      customId,
      values,
      user: { id: userId },
      guild: { members: { fetch: async () => ({ id: userId }) } },
      isButton: () => kind === 'button',
      isStringSelectMenu: () => kind === 'select',
      deferUpdate: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
    };
  }
}

function broker() {
  return new DiscordInteractionBroker({
    timeoutMs: 10_000,
    isAuthorizedMember: member => (member as { id: string } | null)?.id === 'authorized',
  });
}

describe('DiscordInteractionBroker provider questions', () => {
  it('keeps an authorized free-text path when a question also presents options', async () => {
    const thread = new FakeQuestionThread();
    thread.replyText = 'Something not listed';
    thread.message.awaitMessageComponent.mockImplementationOnce(async () => {
      return thread.interaction(thread.idFor(1), 'button');
    });

    const answer = await broker().requestUserInput(thread.channel(), {
      id: 'question-1',
      prompt: 'Choose or explain',
      allowFreeText: true,
      options: [{ label: 'First', value: 'a' }, { label: 'Second', value: 'b' }],
    });

    expect(thread.sent[0].components).toHaveLength(2);
    expect(thread.awaitMessages).toHaveBeenCalledTimes(1);
    expect(answer).toEqual({ skipped: false, values: ['Something not listed'] });
  });

  it('rejects 26 or more choices without silently truncating the available answers', async () => {
    const thread = new FakeQuestionThread();
    const options = Array.from({ length: 26 }, (_, index) => ({ label: `Choice ${index}`, value: `value-${index}` }));
    await expect(broker().requestUserInput(thread.channel(), {
      id: 'question-2', prompt: 'Choose', options,
    })).rejects.toThrow(/26.*25|25.*26/);
    expect(thread.send).not.toHaveBeenCalled();
  });

  it('rechecks authorization and maps select options to provider values', async () => {
    const thread = new FakeQuestionThread();
    const unauthorized = thread.interaction('', 'select', 'stranger', ['option-1']);
    thread.message.awaitMessageComponent.mockImplementationOnce(async () => {
      unauthorized.customId = thread.idFor(0);
      return unauthorized;
    }).mockImplementationOnce(async () => thread.interaction(thread.idFor(0), 'select', 'authorized', ['option-1']));

    const answer = await broker().requestUserInput(thread.channel(), {
      id: 'question-3',
      prompt: 'Select one',
      allowFreeText: true,
      options: [{ label: 'First', value: 'first-value' }, { label: 'Second', value: 'second-value' }],
    });

    expect(unauthorized.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'You are not authorized.' }));
    expect(answer).toEqual({ skipped: false, values: ['second-value'] });
  });
});
