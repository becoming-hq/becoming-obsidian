import type { Append, PendingSource, SourceFile } from './api';
import { sha256 } from './crypto';
import type { PluginData } from './settings';

export interface VaultPort {
  fileExists(path: string): boolean;
  folderExists(path: string): boolean;
  allPaths(): string[];
  read(path: string): Promise<string>;
  create(path: string, content: string): Promise<void>;
  modify(path: string, content: string): Promise<void>;
  process(path: string, fn: (content: string) => string): Promise<string>;
  createFolder(path: string): Promise<void>;
  frontmatter(key: string): Array<{ path: string; value: unknown }>;
}

export interface WriterOptions {
  fetchSource(id: number): Promise<SourceFile | null>;
  notify(message: string): void;
}

type WriterData = Pick<
  PluginData,
  'baseFolder' | 'groupByCategory' | 'resyncDeleted' | 'sources' | 'refetch' | 'deleted'
>;

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/;

export class Writer {
  constructor(
    private readonly vault: VaultPort,
    private readonly data: WriterData,
    private readonly options: WriterOptions,
  ) {}

  async write(source: PendingSource): Promise<void> {
    if (source.first_export) await this.writeFile(source);
    else await this.append(source);
  }

  // Sources whose file the reader deleted while "Resync deleted files" was on.
  // One that turns up again (a rename synced from another device arrives as
  // delete + create) is only re-mapped.
  async refetchQueued(): Promise<void> {
    for (const id of [...this.data.refetch]) {
      if (!this.locate(id)) {
        const file = await this.options.fetchSource(id);
        if (file) await this.writeFile(file);
      }
      this.data.refetch = this.data.refetch.filter((queued) => queued !== id);
    }
  }

  renamed(oldPath: string, newPath: string): boolean {
    let changed = false;
    for (const entry of Object.values(this.data.sources)) {
      if (within(entry.path, oldPath)) {
        entry.path = newPath + entry.path.slice(oldPath.length);
        changed = true;
      }
    }
    return changed;
  }

  deleted(path: string): boolean {
    let changed = false;
    for (const [key, entry] of Object.entries(this.data.sources)) {
      if (!within(entry.path, path)) continue;
      delete this.data.sources[key];
      const id = Number(key);
      if (!this.data.deleted.includes(id)) this.data.deleted.push(id);
      if (this.data.resyncDeleted && !this.data.refetch.includes(id)) this.data.refetch.push(id);
      changed = true;
    }
    return changed;
  }

  private async writeFile(file: SourceFile): Promise<void> {
    const target = this.defaultPath(file);
    const found = this.locate(file.source_id, target);
    if (!found) {
      const path = await this.createFree(dirname(target), file.file_name, file.markdown);
      return this.written(file.source_id, path, file.markdown);
    }
    const current = await this.vault.read(found);
    if (await this.untouched(file.source_id, current)) {
      await this.vault.modify(found, file.markdown);
      return this.written(file.source_id, found, file.markdown);
    }
    // A note from the Markdown zip is this file but for its export date: adopt it as it is.
    if (!this.data.sources[file.source_id]?.hash && sameExport(current, file.markdown)) {
      return this.written(file.source_id, found, current);
    }
    const path = await this.createFree(dirname(found), file.file_name, file.markdown);
    this.options.notify(`Becoming kept your edits in “${found}” and wrote a fresh copy to “${path}”.`);
    return this.written(file.source_id, path, file.markdown);
  }

  private async written(id: number, path: string, content: string): Promise<void> {
    this.record(id, path, await sha256(content));
    this.data.refetch = this.data.refetch.filter((queued) => queued !== id);
  }

  private async append(source: Append): Promise<void> {
    const found = this.locate(source.source_id, this.defaultPath(source));
    if (!found) {
      // Missing is not deleted: a note a vault sync has not brought to this
      // device yet is written in full, never acknowledged unwritten.
      if (this.data.deleted.includes(source.source_id) && !this.data.resyncDeleted) return;
      const file = await this.options.fetchSource(source.source_id);
      if (file) await this.writeFile(file);
      return;
    }
    let before = '';
    const after = await this.vault.process(found, (content) => {
      before = content;
      return appendHighlights(content, source);
    });
    // A file the reader edited stays "edited" after the append, so a later
    // resync never overwrites it.
    const ours = await this.untouched(source.source_id, before);
    this.record(source.source_id, found, ours ? await sha256(after) : null);
  }

  private locate(id: number, preferred?: string): string | null {
    const entry = this.data.sources[id];
    if (entry && this.vault.fileExists(entry.path)) return entry.path;

    const suffix = `/reader/${id}`;
    const matches = this.vault
      .frontmatter('becoming_url')
      .filter(({ value }) => typeof value === 'string' && value.endsWith(suffix))
      .map(({ path }) => path);
    const path = matches.find((match) => match === preferred) ?? matches[0];
    if (!path) return null;
    this.record(id, path, entry?.hash ?? null);
    return path;
  }

  private async untouched(id: number, content: string): Promise<boolean> {
    const hash = this.data.sources[id]?.hash;
    return Boolean(hash) && (await sha256(content)) === hash;
  }

  private async createFree(folder: string, name: string, content: string): Promise<string> {
    if (folder && !this.vault.folderExists(folder)) await this.vault.createFolder(folder);
    const path = freePath(this.vault.allPaths(), folder, name);
    await this.vault.create(path, content);
    return path;
  }

  private defaultPath(source: { folder: string; file_name: string }): string {
    const folder = this.data.groupByCategory ? source.folder : '';
    return joinPath(this.data.baseFolder, folder, `${source.file_name}.md`);
  }

  // A source mapped to a note in the vault is no longer a deleted one.
  private record(id: number, path: string, hash: string | null): void {
    this.data.sources[id] = { path, hash };
    this.data.deleted = this.data.deleted.filter((deleted) => deleted !== id);
  }
}

// The bump is a regex inside the first frontmatter block, never a YAML
// round-trip, so every other byte of the file stays as it was.
export function appendHighlights(
  content: string,
  append: Pick<Append, 'heading' | 'bullets' | 'exported_at' | 'highlight_ids'>,
): string {
  const bumped = content.replace(FRONTMATTER, (block) =>
    block
      .replace(/^highlights: (\d+)$/m, (_, count: string) => `highlights: ${Number(count) + append.highlight_ids.length}`)
      .replace(/^exported_at: .+$/m, () => `exported_at: ${append.exported_at}`),
  );
  return `${bumped.replace(/[\r\n]+$/, '')}\n\n${append.heading}\n\n${append.bullets}`;
}

function sameExport(a: string, b: string): boolean {
  const withoutDate = (content: string) =>
    content.replace(FRONTMATTER, (block) => block.replace(/^exported_at: .+(\r?\n|$)/m, ''));
  return withoutDate(a) === withoutDate(b);
}

// macOS and Windows file systems ignore case, Obsidian's lookups do not.
export function freePath(taken: string[], folder: string, name: string): string {
  const lowered = new Set(taken.map((path) => path.toLowerCase()));
  for (let n = 1; ; n++) {
    const path = joinPath(folder, `${n === 1 ? name : `${name} ${n}`}.md`);
    if (!lowered.has(path.toLowerCase())) return path;
  }
}

function joinPath(...parts: string[]): string {
  return parts.join('/').split('/').filter(Boolean).join('/');
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

function within(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}
