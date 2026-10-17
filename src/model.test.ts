import { describe, expect, it, vi, afterEach } from 'vitest';
import { defaultSettings, personalGenerate, readModelStream } from './model';

afterEach(() => vi.unstubAllGlobals());
describe('model streams', () => {
  it('renders Google text chunks and ignores thinking parts', async () => {
    const response = new Response('data: {"candidates":[{"content":{"parts":[{"text":"private","thought":true},{"text":"Hello "}]}}]}\n\ndata: {"candidates":[{"content":{"parts":[{"text":"world"}]},"finishReason":"STOP"}]}\n\n');
    const update = vi.fn();
    expect(await readModelStream(response, 'gemini', update)).toBe('Hello world');
    expect(update).toHaveBeenLastCalledWith('Hello world');
  });
  it('does not commit an incomplete host stream', async () => {
    await expect(readModelStream(new Response('{"text":"unfinished"}\n'), 'host', () => {})).rejects.toThrow('interrupted');
  });
  it('sends personal credentials directly to the model endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetch);
    await personalGenerate({ ...defaultSettings, provider: 'selfhost', apiKey: 'personal-secret', model: 'gemma4', baseUrl: 'http://localhost:11434/v1' }, 'Test', [{ role: 'user', text: 'Hi' }], new AbortController().signal);
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer personal-secret');
    expect(fetch.mock.calls[0][1].redirect).toBe('error');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
