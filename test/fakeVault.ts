import type { VaultPort } from '../src/writer';

// Obsidian's vault as the spike found it: case-sensitive lookups, `create`
// refuses a missing folder or an existing path, `createFolder` builds nested
// folders and refuses an existing one.
export class FakeVault implements VaultPort {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();

  constructor(files: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(files)) this.put(path, content);
  }

  put(path: string, content: string): void {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) this.folders.add(parts.slice(0, i).join('/'));
    this.files.set(path, content);
  }

  move(from: string, to: string): void {
    const content = this.get(from);
    this.files.delete(from);
    this.put(to, content);
  }

  get(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }

  fileExists(path: string): boolean {
    return this.files.has(path);
  }

  folderExists(path: string): boolean {
    return this.folders.has(path);
  }

  allPaths(): string[] {
    return [...this.folders, ...this.files.keys()];
  }

  async read(path: string): Promise<string> {
    return this.get(path);
  }

  async create(path: string, content: string): Promise<void> {
    const folder = path.split('/').slice(0, -1).join('/');
    if (folder && !this.folders.has(folder)) throw new Error(`ENOENT: ${path}`);
    if (this.files.has(path)) throw new Error('File already exists.');
    this.files.set(path, content);
  }

  async modify(path: string, content: string): Promise<void> {
    this.get(path);
    this.files.set(path, content);
  }

  async process(path: string, fn: (content: string) => string): Promise<string> {
    const next = fn(this.get(path));
    this.files.set(path, next);
    return next;
  }

  async createFolder(path: string): Promise<void> {
    if (this.folders.has(path)) throw new Error('Folder already exists.');
    this.put(`${path}/.keep`, '');
    this.files.delete(`${path}/.keep`);
  }

  frontmatter(key: string): Array<{ path: string; value: unknown }> {
    return [...this.files].flatMap(([path, content]) => {
      const block = /^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? '';
      const value = new RegExp(`^${key}: (.+)$`, 'm').exec(block)?.[1];
      return path.endsWith('.md') && value !== undefined ? [{ path, value }] : [];
    });
  }
}
