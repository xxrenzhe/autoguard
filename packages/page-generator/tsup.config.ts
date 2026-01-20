import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false, // Skip dts to avoid rootDir issues with workspace deps
  splitting: false,
  sourcemap: true,
  clean: true,
});
