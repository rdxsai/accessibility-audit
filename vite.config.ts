import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

// ──────────────────────────────────────────────
// Chrome extension Vite config
//
// The key challenge: Chrome content scripts cannot use ES module
// imports. They are injected into pages as plain scripts.
// So content.js must be fully self-contained — no chunk imports.
//
// Solution: We use `output.inlineDynamicImports: false` won't work
// with multiple inputs. Instead we force Rollup to put the commonjs
// helper into each entry by setting the commonjs `ignoreDynamicRequires`.
// ──────────────────────────────────────────────

function copyExtensionFiles() {
  return {
    name: 'copy-extension-files',
    closeBundle() {
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(__dirname, 'dist/manifest.json')
      );

      const iconsDir = resolve(__dirname, 'dist/icons');
      if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });

      const srcIcons = resolve(__dirname, 'public/icons');
      if (existsSync(srcIcons)) {
        for (const file of readdirSync(srcIcons)) {
          copyFileSync(resolve(srcIcons, file), resolve(iconsDir, file));
        }
      }
    },
  };
}

// Post-build plugin that inlines the commonjs helper chunk into
// content.js. This is necessary because Chrome content scripts
// cannot load separate JS files via import.
function inlineContentScript() {
  return {
    name: 'inline-content-script',
    async closeBundle() {
      const fs = await import('fs');
      const distDir = resolve(__dirname, 'dist');

      // Find the commonjs helper chunk
      const assetsDir = resolve(distDir, 'assets');
      if (!fs.existsSync(assetsDir)) return;

      const helperFiles = fs.readdirSync(assetsDir).filter(
        (f: string) => f.startsWith('_commonjsHelpers') && f.endsWith('.js')
      );

      if (helperFiles.length === 0) return;

      const helperPath = resolve(assetsDir, helperFiles[0]);
      const helperCode = fs.readFileSync(helperPath, 'utf-8');

      // Read content.js and replace the import with inlined code
      const contentPath = resolve(distDir, 'content.js');
      let contentCode = fs.readFileSync(contentPath, 'utf-8');

      // Extract what's being imported from the helper
      // e.g. import{g as HR}from"./assets/_commonjsHelpers-CqkleIqs.js";
      const importRegex = /import\s*\{([^}]+)\}\s*from\s*"\.\/assets\/_commonjsHelpers[^"]*\.js"\s*;?/;
      const match = contentCode.match(importRegex);

      if (match) {
        // Parse the helper to extract the exported function
        // The helper exports a single function like: function getDefaultExportFromCjs(x) { ... }
        // export { getDefaultExportFromCjs as g };
        // We need to inline the function and alias it.

        // Simpler approach: prepend the helper content (minus its export)
        // and replace the import with a direct reference.
        const helperWithoutExport = helperCode
          .replace(/export\s*\{[^}]*\}\s*;?/g, '')
          .trim();

        // Get the alias mapping, e.g. "g as HR" → HR is local name, g is exported name
        const imports = match[1].split(',').map((s: string) => s.trim());
        let aliasDeclarations = '';

        for (const imp of imports) {
          const parts = imp.split(/\s+as\s+/);
          const exportedName = parts[0].trim();
          const localName = (parts[1] || parts[0]).trim();

          // Find what the exported name maps to in the helper
          const exportMatch = helperCode.match(
            new RegExp(`(\\w+)\\s+as\\s+${exportedName}`)
          );
          const realName = exportMatch ? exportMatch[1] : exportedName;

          if (localName !== realName) {
            aliasDeclarations += `var ${localName} = ${realName};\n`;
          }
        }

        contentCode = contentCode.replace(match[0], '');
        contentCode = helperWithoutExport + '\n' + aliasDeclarations + contentCode;

        fs.writeFileSync(contentPath, contentCode);

        // Also fix background.js if it has the same import
        const bgPath = resolve(distDir, 'background.js');
        if (fs.existsSync(bgPath)) {
          let bgCode = fs.readFileSync(bgPath, 'utf-8');
          if (importRegex.test(bgCode)) {
            bgCode = bgCode.replace(importRegex, '');
            fs.writeFileSync(bgPath, bgCode);
          }
        }
      }

      // Copy the highlight CSS for the content script
      const highlightCss = resolve(__dirname, 'src/content/highlight.css');
      if (fs.existsSync(highlightCss)) {
        fs.copyFileSync(highlightCss, resolve(distDir, 'content.css'));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionFiles(), inlineContentScript()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: 'dist',
    emptyDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
