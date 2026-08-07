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
        // Stamped into the bundle so any embed's console reveals which build is
        // actually running. The deployed copy lives in another repo and has
        // silently lagged this source tree before.
        __WIDGET_BUILD__: JSON.stringify(new Date().toISOString()),
    },
});
