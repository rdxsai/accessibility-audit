// Quick test script — simulates what content/index.ts does.
// Launches real Chromium, loads the page, injects axe-core, runs scan.

import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'https://rdxsai.vercel.app/';

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

console.log(`Loading: ${url}\n`);
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

// Inject axe-core (same library bundled in our content script)
const axeSource = readFileSync(
  resolve(__dirname, 'node_modules/axe-core/axe.min.js'),
  'utf-8'
);
await page.evaluate(axeSource);

// Run the scan — same call as our content script's runScan()
const results = await page.evaluate(async () => {
  const raw = await window.axe.run(document, {
    resultTypes: ['violations'],
  });

  return raw.violations.map((result) => ({
    id: result.id,
    impact: result.impact ?? 'minor',
    description: result.description,
    helpUrl: result.helpUrl,
    wcagTags: result.tags.filter((tag) => tag.startsWith('wcag')),
    nodes: result.nodes.map((node) => ({
      html: node.html,
      target: node.target.map(String),
      failureSummary: node.failureSummary ?? '',
    })),
  }));
});

await browser.close();

// Print results
console.log(`Found ${results.length} violations\n`);
console.log('='.repeat(70));

for (const v of results) {
  console.log(`\n[${v.impact.toUpperCase()}] ${v.id}`);
  console.log(`  ${v.description}`);
  console.log(`  WCAG: ${v.wcagTags.join(', ') || 'none'}`);
  console.log(`  Help: ${v.helpUrl}`);
  console.log(`  Elements affected: ${v.nodes.length}`);
  for (const node of v.nodes.slice(0, 3)) {
    console.log(`    ─ ${node.target.join(' > ')}`);
    console.log(`      HTML: ${node.html.slice(0, 120)}`);
    console.log(`      Why:  ${node.failureSummary.split('\n')[0]}`);
  }
  if (v.nodes.length > 3) {
    console.log(`    ... and ${v.nodes.length - 3} more elements`);
  }
  console.log('─'.repeat(70));
}
