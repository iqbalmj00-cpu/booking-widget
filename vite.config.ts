import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
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
    },
});
