import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "web-dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: "web-src/main.js",
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return "app.css";
          }
          return "assets/[name][extname]";
        },
      },
    },
  },
});
