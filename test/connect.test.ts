import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenPoll } from '../src/api';
import { connect, deviceName, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from '../src/connect';

const PENDING: TokenPoll = { kind: 'pending' };

function deps(...answers: TokenPoll[]) {
  return {
    open: vi.fn(),
    poll: vi.fn(async (): Promise<TokenPoll> => answers.shift() ?? PENDING),
  };
}

describe('connect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the approve page and polls until the token arrives', async () => {
    const flow = deps(PENDING, PENDING, { kind: 'token', token: 'secret' });
    const outcome = connect(flow, 'https://app.usebecoming.com/', 'Obsidian · My vault · macOS', new AbortController().signal);

    await vi.advanceTimersByTimeAsync(3 * POLL_INTERVAL_MS);

    await expect(outcome).resolves.toEqual({ kind: 'token', token: 'secret' });
    const url = new URL(flow.open.mock.calls[0]?.[0]);
    expect(url.origin + url.pathname).toBe('https://app.usebecoming.com/connect/obsidian');
    expect(url.searchParams.get('code')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('name')).toBe('Obsidian · My vault · macOS');
    expect(flow.poll).toHaveBeenCalledTimes(3);
    expect(flow.poll).toHaveBeenCalledWith(url.searchParams.get('code'));

    await vi.advanceTimersByTimeAsync(10 * POLL_INTERVAL_MS);
    expect(flow.poll).toHaveBeenCalledTimes(3);
  });

  it('stops when the code expired', async () => {
    const flow = deps({ kind: 'expired' });
    const outcome = connect(flow, 'https://app.usebecoming.com', 'name', new AbortController().signal);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    await expect(outcome).resolves.toEqual({ kind: 'expired' });
    await vi.advanceTimersByTimeAsync(10 * POLL_INTERVAL_MS);
    expect(flow.poll).toHaveBeenCalledOnce();
  });

  it('gives up after ten minutes', async () => {
    const flow = deps();
    const outcome = connect(flow, 'https://app.usebecoming.com', 'name', new AbortController().signal);

    await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + POLL_INTERVAL_MS);

    await expect(outcome).resolves.toEqual({ kind: 'timeout' });
    expect(flow.poll.mock.calls.length).toBeLessThanOrEqual(POLL_TIMEOUT_MS / POLL_INTERVAL_MS);
  });

  it('keeps polling through a network error', async () => {
    const flow = deps();
    flow.poll.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ kind: 'token', token: 'secret' });
    const outcome = connect(flow, 'https://app.usebecoming.com', 'name', new AbortController().signal);

    await vi.advanceTimersByTimeAsync(2 * POLL_INTERVAL_MS);

    await expect(outcome).resolves.toEqual({ kind: 'token', token: 'secret' });
  });

  it('stops when cancelled', async () => {
    const flow = deps();
    const controller = new AbortController();
    const outcome = connect(flow, 'https://app.usebecoming.com', 'name', controller.signal);

    controller.abort();

    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
    expect(flow.poll).not.toHaveBeenCalled();
  });
});

describe('deviceName', () => {
  it('names the vault and the platform', () => {
    expect(deviceName('Notes', 'macOS')).toBe('Obsidian · Notes · macOS');
  });

  it('shortens a long vault name to fit 60 characters, keeping the platform', () => {
    const name = deviceName('A'.repeat(100), 'Windows');

    expect(name).toHaveLength(60);
    expect(name.endsWith(' · Windows')).toBe(true);
  });
});
