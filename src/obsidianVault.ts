import { type App, type EventRef, TFile, TFolder } from 'obsidian';
import type { VaultPort } from './writer';

export class ObsidianVault implements VaultPort {
  constructor(private readonly app: App) {}

  fileExists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
  }

  folderExists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) instanceof TFolder;
  }

  allPaths(): string[] {
    return this.app.vault.getAllLoadedFiles().map((file) => file.path);
  }

  read(path: string): Promise<string> {
    return this.app.vault.read(this.file(path));
  }

  async create(path: string, content: string): Promise<void> {
    await this.app.vault.create(path, content);
  }

  modify(path: string, content: string): Promise<void> {
    return this.app.vault.modify(this.file(path), content);
  }

  process(path: string, fn: (content: string) => string): Promise<string> {
    return this.app.vault.process(this.file(path), fn);
  }

  async createFolder(path: string): Promise<void> {
    await this.app.vault.createFolder(path);
  }

  frontmatter(key: string): Array<{ path: string; value: unknown }> {
    return this.app.vault.getMarkdownFiles().flatMap((file) => {
      const value: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
      return value === undefined ? [] : [{ path: file.path, value }];
    });
  }

  private file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Becoming: no file at ${path}`);
    return file;
  }
}

// Ready once every note has its metadata, which a frontmatter lookup needs.
// A plugin enabled long after startup finds it ready; at startup the cache
// is still indexing and fires `resolved` when done.
export function whenCacheReady(app: App, register: (ref: EventRef) => void): Promise<void> {
  const ready = app.vault.getMarkdownFiles().every((file) => app.metadataCache.getFileCache(file) !== null);
  if (ready) return Promise.resolve();
  return new Promise((resolve) => {
    const ref = app.metadataCache.on('resolved', () => {
      app.metadataCache.offref(ref);
      resolve();
    });
    register(ref);
  });
}
