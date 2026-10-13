export type Status = 'idle' | 'syncing' | 'paused' | 'busy' | 'failed';

const TEXT: Record<Exclude<Status, 'idle'>, string> = {
  syncing: 'Becoming: syncing…',
  paused: 'Becoming: paused',
  busy: 'Becoming: syncing on another device',
  failed: 'Becoming: sync failed',
};

export function statusText(status: Status, connected: boolean, lastSyncedAt: string | null, now: number): string {
  if (!connected) return 'Becoming: not connected';
  if (status !== 'idle') return TEXT[status];
  return lastSyncedAt ? `Becoming: synced ${ago(now - Date.parse(lastSyncedAt))}` : 'Becoming: not synced yet';
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
