import { requestUrl, type RequestUrlResponse } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BecomingApi, CLIENT_ID_KEY, installClientId } from '../src/api';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

const request = vi.mocked(requestUrl);

function respond(status: number, json: unknown = {}): void {
  request.mockResolvedValue({ status, json } as RequestUrlResponse);
}

describe('BecomingApi', () => {
  const api = new BecomingApi({ apiBaseUrl: 'http://api.example.localhost/', token: 'secret' }, 'client-1');

  beforeEach(() => {
    request.mockReset();
  });

  it.each([
    ['pending', () => api.pending(), 'GET', '/exports/obsidian/pending'],
    ['acks', () => api.ack([1, 2], true), 'POST', '/exports/obsidian/acks'],
    ['sources/:id', () => api.source(42), 'GET', '/exports/obsidian/sources/42'],
    ['resets', () => api.reset(), 'POST', '/exports/obsidian/resets'],
  ])('sends the bearer and the install id on %s', async (_, send, method, path) => {
    respond(200);

    await send();

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `http://api.example.localhost${path}`,
        method,
        throw: false,
        headers: expect.objectContaining({ Authorization: 'Bearer secret', 'X-Obsidian-Client': 'client-1' }),
      }),
    );
  });

  it('acks with the journal ids and last_page', async () => {
    respond(200, { acknowledged: 2 });

    await api.ack([1, 2], true);

    expect(request.mock.calls[0]?.[0]).toMatchObject({ body: JSON.stringify({ user_highlight_ids: [1, 2], last_page: true }) });
  });

  it('maps sync errors by status', async () => {
    respond(409, { error: 'obsidian_sync_in_progress' });
    await expect(api.pending()).rejects.toMatchObject({ kind: 'busy' });

    respond(404, { error: 'source_not_found' });
    await expect(api.source(42)).resolves.toBeNull();
  });
});

describe('installClientId', () => {
  it('makes an id once and reuses it', () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => void saved.set(key, value),
    };

    const id = installClientId(storage);

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.get(CLIENT_ID_KEY)).toBe(id);
    expect(installClientId(storage)).toBe(id);
  });
});
