import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sourceRoot = resolve(__dirname, "src");

function extensionEntryName(facadeModuleId: string | null): string {
  if (!facadeModuleId) {
    return "assets/[name].js";
  }

  if (facadeModuleId.endsWith("service-worker.ts")) {
    return "service-worker.js";
  }

  if (facadeModuleId.endsWith("collector.ts")) {
    return "content/collector.js";
  }

  return "assets/[name].js";
}

export default defineConfig({
  plugins: [react()],
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "sidepanel.html"),
        "service-worker": resolve(sourceRoot, "background", "service-worker.ts")
      },
      output: {
        entryFileNames: (chunk) => extensionEntryName(chunk.facadeModuleId),
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
