// Runtime stand-in for the typings-only `obsidian` package (see vitest.config.ts).
export function requestUrl(): never {
  throw new Error('requestUrl is not available in tests');
}

export const normalizePath = (path: string): string => path;

export class PluginSettingTab {}

export class Setting {}
