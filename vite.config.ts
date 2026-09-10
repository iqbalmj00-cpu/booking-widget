import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sourceFingerprint } from "./scripts/source-fingerprint.mjs";

export default defineConfig({
    plugins: [react()],
    // Controlled builds do not load ambient .env files.
    envDir: false,
    // Prevent workspace-root discovery from walking outside the staged project.
    server: { fs: { allow: [process.cwd()] } },
    // Inline options disable PostCSS file/package/ancestor configuration discovery.
    css: { postcss: { plugins: [] } },
    build: {
        lib: {
            entry: "src/main.tsx",
            name: "SYJBooking",
            fileName: "embed",
            formats: ["iife"],
        },
        cssCodeSplit: false,
        rollupOptions: {
            output: {
                inlineDynamicImports: true,
                assetFileNames: "embed.[ext]",
            },
        },
        minify: "esbuild",
        target: "es2020",
    },
    define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
        // Deterministic ID; a direct Vite build is explicitly unverified.
        __WIDGET_BUILD__: JSON.stringify(process.env.SYJ_WIDGET_BUILD_ID || `unverified-${sourceFingerprint()}`),
    },
});
