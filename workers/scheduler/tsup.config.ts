import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  splitting: false,
  clean: true,
  sourcemap: true,
  target: 'node20',
  external: ['better-sqlite3'],
});
