import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The `obsidian` package ships typings only; tests run against a stub.
export default defineConfig({
  resolve: {
    alias: { obsidian: fileURLToPath(new URL('./test/obsidian.ts', import.meta.url)) },
  },
});
