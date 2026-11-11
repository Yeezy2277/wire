import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // tsconfig keeps JSX as-is for Next; tests need it compiled.
  esbuild: { jsx: "automatic" },
  // Pure core and route tests run in node; component tests opt into jsdom per file.
  test: { include: ["src/**/*.test.{ts,tsx}"], environment: "node" },
});
