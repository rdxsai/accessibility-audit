// Tests the complete Stage 1 + Stage 2 pipeline headlessly.
// Simulates exactly what the content script does.

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

// Inject axe-core
const axeSource = readFileSync(
  resolve(__dirname, 'node_modules/axe-core/axe.min.js'), 'utf-8'
);
await page.evaluate(axeSource);

// ─── STAGE 1: axe-core ───
console.log('═══ STAGE 1: axe-core ═══');
const axeResults = await page.evaluate(async () => {
  const raw = await window.axe.run(document, { resultTypes: ['violations'] });
  return raw.violations.map(r => ({
    id: r.id, impact: r.impact, description: r.description,
    nodes: r.nodes.length, tags: r.tags.filter(t => t.startsWith('wcag')),
  }));
});
console.log(`Found ${axeResults.length} violations:`);
for (const v of axeResults) {
  console.log(`  [${v.impact}] ${v.id}: ${v.description} (${v.nodes} elements)`);
}

// ─── STAGE 2: Programmatic audits ───
// We need to inject the audit code. Since it's bundled in content.js,
// let's run the audit logic inline.

console.log('\n═══ STAGE 2a: Contrast Audit ═══');
const contrast = await page.evaluate(() => {
  const SKIP = new Set(['script','style','noscript','svg','path','meta','link','br','hr','img','video','audio','canvas','iframe','object']);
  const MAX = 200;
  const seen = new Set();
  const failures = [];
  let total = 0, passes = 0;

  function parseRgb(c) {
    const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  }
  function blend(fg, bg) {
    const a = fg.a;
    return { r: Math.round(fg.r*a+bg.r*(1-a)), g: Math.round(fg.g*a+bg.g*(1-a)), b: Math.round(fg.b*a+bg.b*(1-a)), a:1 };
  }
  function lum(rgb) {
    const [r,g,b] = [rgb.r,rgb.g,rgb.b].map(c => { const s=c/255; return s<=0.04045?s/12.92:Math.pow((s+0.055)/1.055,2.4); });
    return 0.2126*r+0.7152*g+0.0722*b;
  }
  function cr(a, b) { const l1=lum(a),l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); }
  function getBg(el) {
    let cur = el;
    while (cur) { const bg = getComputedStyle(cur).backgroundColor; const rgb = parseRgb(bg); if (rgb && rgb.a >= 1) return bg; cur = cur.parentElement; }
    return 'rgb(255,255,255)';
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.textContent?.trim()) return NodeFilter.FILTER_REJECT;
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (SKIP.has(p.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
      if (p.closest('[aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
      const s = getComputedStyle(p);
      if (s.display==='none'||s.visibility==='hidden'||s.opacity==='0') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let node;
  while ((node = walker.nextNode())) {
    if (seen.size >= MAX) break;
    total++;
    const p = node.parentElement;
    const fg = getComputedStyle(p).color;
    const bg = getBg(p);
    const key = `${fg}|${bg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fgRgb = parseRgb(fg), bgRgb = parseRgb(bg);
    if (!fgRgb || !bgRgb) continue;
    const ratio = cr(blend(fgRgb, bgRgb), bgRgb);
    const fs = parseFloat(getComputedStyle(p).fontSize);
    const fw = parseInt(getComputedStyle(p).fontWeight) || 400;
    const isLarge = fs >= 18 || (fs >= 14 && fw >= 700);
    const req = isLarge ? 3 : 4.5;
    if (ratio >= req) { passes++; } else {
      failures.push({ text: node.textContent.trim().slice(0,40), fg, bg, ratio: Math.round(ratio*100)/100, fontSize: fs+'px', required: req });
    }
  }
  return { total, combos: seen.size, failures: failures.length, passes, details: failures };
});
console.log(`Scanned ${contrast.total} text elements, ${contrast.combos} unique combos`);
console.log(`Failures: ${contrast.failures}, Passes: ${contrast.passes}`);
for (const f of contrast.details) {
  console.log(`  FAIL: "${f.text}" — ratio=${f.ratio}:1 (need ${f.required}:1), fg=${f.fg}, bg=${f.bg}`);
}

console.log('\n═══ STAGE 2b: ARIA Audit ═══');
const aria = await page.evaluate(() => {
  const buttons = document.querySelectorAll('button, [role="button"]');
  const buttonIssues = [];
  buttons.forEach(el => {
    const exp = el.getAttribute('aria-expanded');
    const ctrl = el.getAttribute('aria-controls');
    const text = (el.textContent||'').trim().slice(0,40);
    if (exp === null) buttonIssues.push({ text, expanded: exp, controls: ctrl });
  });

  const sections = document.querySelectorAll('section, [role="region"]');
  const sectionIssues = [];
  sections.forEach(el => {
    if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
      sectionIssues.push({ id: el.id || '(no id)', classes: el.className?.toString().slice(0,30) });
    }
  });

  const decorative = [];
  document.querySelectorAll('canvas, svg').forEach(el => {
    if (el.closest('a, button')) return;
    if (el.getAttribute('aria-hidden') !== 'true' && el.getAttribute('role') !== 'presentation') {
      decorative.push({ tag: el.tagName.toLowerCase(), class: el.className?.toString?.()?.slice(0,30) || '' });
    }
  });

  return {
    totalButtons: buttons.length, buttonIssues,
    totalSections: sections.length, sectionIssues,
    decorativeIssues: decorative,
  };
});
console.log(`Buttons: ${aria.totalButtons} total, ${aria.buttonIssues.length} missing aria-expanded`);
for (const b of aria.buttonIssues) console.log(`  "${b.text}" — expanded=${b.expanded}, controls=${b.controls}`);
console.log(`Sections: ${aria.totalSections} total, ${aria.sectionIssues.length} without name`);
for (const s of aria.sectionIssues) console.log(`  id=${s.id}, class=${s.classes}`);
console.log(`Decorative not hidden: ${aria.decorativeIssues.length}`);
for (const d of aria.decorativeIssues) console.log(`  <${d.tag}> class="${d.class}"`);

console.log('\n═══ STAGE 2c: Motion Audit ═══');
const motion = await page.evaluate(() => {
  let hasCSS = false;
  try { for (const s of document.styleSheets) { try { for (const r of s.cssRules) { if (r instanceof CSSMediaRule && r.conditionText?.includes('prefers-reduced-motion')) hasCSS = true; } } catch {} } } catch {}
  let hasJS = false;
  document.querySelectorAll('script:not([src])').forEach(s => { if (s.textContent?.includes('prefers-reduced-motion')) hasJS = true; });
  const anims = [];
  document.querySelectorAll('*').forEach(el => { const a = getComputedStyle(el).animationName; if (a && a !== 'none') anims.push({ sel: el.className?.toString?.()?.slice(0,20), name: a }); });
  const canvases = [];
  document.querySelectorAll('canvas').forEach(c => canvases.push({ class: c.className, hidden: c.getAttribute('aria-hidden') }));
  return { hasCSS, hasJS, anims, canvases };
});
console.log(`prefers-reduced-motion in CSS: ${motion.hasCSS}`);
console.log(`prefers-reduced-motion in JS: ${motion.hasJS}`);
console.log(`CSS animations: ${motion.anims.length}`);
for (const a of motion.anims) console.log(`  .${a.sel}: ${a.name}`);
console.log(`Canvas: ${motion.canvases.length}`);
for (const c of motion.canvases) console.log(`  .${c.class}: aria-hidden=${c.hidden}`);

console.log('\n═══ STAGE 2d: Focus Audit (style diffing) ═══');
const focus = await page.evaluate(() => {
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), [tabindex]:not([tabindex="-1"])';
  const PROPS = ['outlineStyle','outlineColor','outlineWidth','boxShadow','borderColor','backgroundColor'];
  const els = Array.from(document.querySelectorAll(FOCUSABLE)).filter(el => {
    const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden';
  });

  const first = els[0];
  const hasSkipLink = first?.tagName === 'A' && (first.getAttribute('href')||'').startsWith('#') && /skip|main/i.test(first.textContent||'');

  const noFocus = [], hasFocus = [];
  for (const el of els.slice(0, 30)) {
    const before = {};
    for (const p of PROPS) before[p] = getComputedStyle(el)[p];
    el.focus();
    const after = {};
    for (const p of PROPS) after[p] = getComputedStyle(el)[p];
    el.blur();
    const changed = PROPS.some(p => before[p] !== after[p]);
    const tag = el.tagName.toLowerCase();
    const text = (el.textContent||'').trim().slice(0,30);
    if (changed) hasFocus.push(`<${tag}> "${text}"`);
    else noFocus.push(`<${tag}> "${text}"`);
  }
  return { total: els.length, hasSkipLink, noFocus, hasFocus };
});
console.log(`Total focusable: ${focus.total}`);
console.log(`Skip link: ${focus.hasSkipLink}`);
console.log(`WITH focus style change: ${focus.hasFocus.length}`);
for (const e of focus.hasFocus) console.log(`  ✓ ${e}`);
console.log(`WITHOUT focus style change: ${focus.noFocus.length}`);
for (const e of focus.noFocus) console.log(`  ✗ ${e}`);

console.log('\n═══ STAGE 2e: Target Size ═══');
const targets = await page.evaluate(() => {
  const els = document.querySelectorAll('a[href], button, [role="button"]');
  const below44 = [];
  let checked = 0;
  els.forEach(el => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' && ['p','li','span'].includes(el.parentElement?.tagName.toLowerCase())) return;
    const r = el.getBoundingClientRect();
    checked++;
    if (Math.min(r.width, r.height) < 44) {
      below44.push({ tag, text: (el.textContent||'').trim().slice(0,30), w: Math.round(r.width), h: Math.round(r.height) });
    }
  });
  return { total: els.length, checked, below44 };
});
console.log(`Checked ${targets.checked} of ${targets.total}`);
console.log(`Below 44px: ${targets.below44.length}`);
for (const t of targets.below44) console.log(`  <${t.tag}> "${t.text}" — ${t.w}x${t.h}px`);

await browser.close();
console.log('\n═══ PIPELINE TEST COMPLETE ═══');
