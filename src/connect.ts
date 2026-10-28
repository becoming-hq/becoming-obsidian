import type { TokenPoll } from './api';
import { randomHex } from './crypto';

export const POLL_INTERVAL_MS = 2_000;
export const POLL_TIMEOUT_MS = 10 * 60_000;
const NAME_MAX = 60;

export type ConnectOutcome = Exclude<TokenPoll, { kind: 'pending' }> | { kind: 'timeout' } | { kind: 'cancelled' };

export interface ConnectDeps {
  open: (url: string) => void;
  poll: (code: string) => Promise<TokenPoll>;
}

export function deviceName(vaultName: string, platform: string): string {
  const room = NAME_MAX - `Obsidian ·  · ${platform}`.length;
  const vault = Array.from(vaultName.trim()).slice(0, Math.max(room, 0)).join('');
  return `Obsidian · ${vault} · ${platform}`;
}

export async function connect(
  deps: ConnectDeps,
  webBaseUrl: string,
  name: string,
  signal: AbortSignal,
): Promise<ConnectOutcome> {
  const code = randomHex(32);
  const url = `${webBaseUrl.replace(/\/+$/, '')}/connect/obsidian?code=${code}&name=${encodeURIComponent(name)}`;
  deps.open(url);
  return waitForToken(deps.poll, code, signal);
}

async function waitForToken(
  poll: (code: string) => Promise<TokenPoll>,
  code: string,
  signal: AbortSignal,
): Promise<ConnectOutcome> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS, signal);
    if (signal.aborted) return { kind: 'cancelled' };
    // A network blip keeps polling: the reader may be approving right now.
    const result = await poll(code).catch((): TokenPoll => ({ kind: 'pending' }));
    if (result.kind !== 'pending') return result;
  }
  return { kind: 'timeout' };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = window.setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}
