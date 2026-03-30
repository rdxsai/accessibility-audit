// Tests the Tier 2 browser inspection tools against a real page.
// Simulates exactly what the content script tools do.

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

// Inject the built content script (has all tools bundled)
const contentScript = readFileSync(
  resolve(__dirname, 'dist/content.js'),
  'utf-8'
);

// Remove the chrome.runtime references (they don't exist in puppeteer)
// We'll call the tool functions directly instead
const axeSource = readFileSync(
  resolve(__dirname, 'node_modules/axe-core/axe.min.js'),
  'utf-8'
);
await page.evaluate(axeSource);

// ─── Test 1: Computed styles on nav links (the contrast issue axe missed) ───
console.log('═══ TEST: get_computed_styles on nav links ═══\n');
const navStyles = await page.evaluate(() => {
  const links = document.querySelectorAll('nav a, .nav a, header a');
  return Array.from(links).map((el) => {
    const style = getComputedStyle(el);
    const text = (el.textContent || '').trim();
    return {
      text: text.slice(0, 30),
      color: style.color,
      backgroundColor: style.backgroundColor,
      opacity: style.opacity,
      fontSize: style.fontSize,
    };
  });
});
for (const s of navStyles) {
  console.log(`  "${s.text}" → color: ${s.color}, bg: ${s.backgroundColor}, opacity: ${s.opacity}, font: ${s.fontSize}`);
}

// ─── Test 2: Element interactions on buttons ───
console.log('\n═══ TEST: get_element_interactions on buttons ═══\n');
const buttons = await page.evaluate(() => {
  const btns = document.querySelectorAll('button');
  return Array.from(btns).map((el) => ({
    text: (el.textContent || '').trim().slice(0, 40),
    role: el.getAttribute('role'),
    ariaExpanded: el.getAttribute('aria-expanded'),
    ariaControls: el.getAttribute('aria-controls'),
    ariaLabel: el.getAttribute('aria-label'),
  }));
});
for (const b of buttons) {
  console.log(`  "${b.text}" → role: ${b.role}, aria-expanded: ${b.ariaExpanded}, aria-controls: ${b.ariaControls}`);
}

// ─── Test 3: Focus order check ───
console.log('\n═══ TEST: check_focus_order (first 10 elements) ═══\n');
const focusData = await page.evaluate(() => {
  const focusable = Array.from(document.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), [tabindex]:not([tabindex="-1"])'
  )).filter((el) => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  });

  // Check for skip link
  const first = focusable[0];
  const hasSkipLink = first?.tagName === 'A' &&
    (first.getAttribute('href') || '').startsWith('#') &&
    (first.textContent || '').toLowerCase().includes('skip');

  const entries = focusable.slice(0, 10).map((el, i) => {
    const prev = getComputedStyle(el).outlineStyle;
    (el).focus();
    const style = getComputedStyle(el);
    return {
      index: i,
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 30),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      focusVisible: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1,
    };
  });

  return { hasSkipLink, totalFocusable: focusable.length, entries };
});

console.log(`  Skip link present: ${focusData.hasSkipLink}`);
console.log(`  Total focusable elements: ${focusData.totalFocusable}\n`);
for (const e of focusData.entries) {
  const icon = e.focusVisible ? '✓' : '✗';
  console.log(`  ${icon} [${e.index}] <${e.tag}> "${e.text}" → outline: ${e.outlineStyle} ${e.outlineWidth}`);
}

// ─── Test 4: Motion check ───
console.log('\n═══ TEST: check_motion ═══\n');
const motion = await page.evaluate(() => {
  const canvases = Array.from(document.querySelectorAll('canvas')).map((c) => ({
    classes: c.className,
    ariaHidden: c.getAttribute('aria-hidden'),
    width: c.width,
    height: c.height,
  }));

  let hasReducedMotionQuery = false;
  try {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSMediaRule && rule.conditionText?.includes('prefers-reduced-motion')) {
            hasReducedMotionQuery = true;
          }
        }
      } catch { continue; }
    }
  } catch {}

  const animations = [];
  for (const el of document.querySelectorAll('*')) {
    const anim = getComputedStyle(el).animationName;
    if (anim && anim !== 'none') {
      animations.push({ tag: el.tagName.toLowerCase(), class: el.className, animation: anim });
    }
  }

  return { canvases, hasReducedMotionQuery, animations };
});

console.log(`  Canvas elements: ${motion.canvases.length}`);
for (const c of motion.canvases) {
  console.log(`    .${c.classes} → aria-hidden: ${c.ariaHidden}, size: ${c.width}x${c.height}`);
}
console.log(`  CSS animations running: ${motion.animations.length}`);
for (const a of motion.animations) {
  console.log(`    <${a.tag} class="${a.class}"> → ${a.animation}`);
}
console.log(`  prefers-reduced-motion query in CSS: ${motion.hasReducedMotionQuery}`);

// ─── Test 5: Landmark structure ───
console.log('\n═══ TEST: DOM landmark snapshot ═══\n');
const landmarks = await page.evaluate(() => {
  const landmarkTags = ['main', 'nav', 'header', 'footer', 'aside', 'section', 'article'];
  const results = [];
  for (const tag of landmarkTags) {
    const els = document.querySelectorAll(tag);
    for (const el of els) {
      results.push({
        tag,
        ariaLabel: el.getAttribute('aria-label'),
        ariaLabelledBy: el.getAttribute('aria-labelledby'),
        id: el.id || null,
        classes: el.className?.toString().slice(0, 40) || null,
      });
    }
  }
  return results;
});

for (const l of landmarks) {
  const name = l.ariaLabel || l.ariaLabelledBy || '(no accessible name)';
  console.log(`  <${l.tag}${l.id ? ' #' + l.id : ''}${l.classes ? ' .' + l.classes.split(' ')[0] : ''}> → ${name}`);
}

await browser.close();
console.log('\n═══ DONE ═══');
