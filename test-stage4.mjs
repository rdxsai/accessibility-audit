// Test Stage 4 end-to-end: collect data headlessly, then send to OpenAI.
// This bypasses the Chrome extension entirely.

import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'https://rdxsai.vercel.app/';

// Read API key from .env
const envFile = readFileSync(resolve(__dirname, '.env'), 'utf-8');
const apiKey = (envFile.match(/OPENAI_API_KEY=(.+)/)?.[1] || envFile.match(/OPEN_AI_API=(.+)/)?.[1])?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

console.log('=== Collecting data headlessly ===\n');

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

// Inject axe
const axeSource = readFileSync(resolve(__dirname, 'node_modules/axe-core/axe.min.js'), 'utf-8');
await page.evaluate(axeSource);

// Stage 1
const axe = await page.evaluate(async () => {
  const r = await window.axe.run(document, { resultTypes: ['violations'] });
  return r.violations.map(v => ({
    id: v.id, impact: v.impact, description: v.description,
    wcagTags: v.tags.filter(t => t.startsWith('wcag')),
    nodes: v.nodes.slice(0, 3).map(n => ({ target: n.target.map(String), html: n.html.slice(0, 120) })),
  }));
});

// Stage 2 (inline — same logic as audits)
const stage2 = await page.evaluate(() => {
  // Contrast
  function parseRgb(c){const m=c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);if(!m)return null;return{r:+m[1],g:+m[2],b:+m[3],a:m[4]!==undefined?+m[4]:1}}
  function blend(f,b){const a=f.a;return{r:Math.round(f.r*a+b.r*(1-a)),g:Math.round(f.g*a+b.g*(1-a)),b:Math.round(f.b*a+b.b*(1-a)),a:1}}
  function lum(c){const[r,g,b]=[c.r,c.g,c.b].map(v=>{const s=v/255;return s<=0.04045?s/12.92:Math.pow((s+0.055)/1.055,2.4)});return .2126*r+.7152*g+.0722*b}
  function cr(a,b){const l1=lum(a),l2=lum(b);return(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)}
  function getBg(el){let c=el;while(c){const bg=getComputedStyle(c).backgroundColor;const rgb=parseRgb(bg);if(rgb&&rgb.a>=1)return bg;c=c.parentElement}return'rgb(255,255,255)'}

  const contrastFailures=[];const seen=new Set();
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode(n){if(!n.textContent?.trim())return 2;const p=n.parentElement;if(!p)return 2;if(['script','style','svg','canvas'].includes(p.tagName.toLowerCase()))return 2;if(p.closest('[aria-hidden="true"]'))return 2;const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden')return 2;return 1}});
  let nd;while((nd=w.nextNode())&&seen.size<200){const p=nd.parentElement;const fg=getComputedStyle(p).color;const bg=getBg(p);const k=fg+'|'+bg;if(seen.has(k))continue;seen.add(k);const fR=parseRgb(fg),bR=parseRgb(bg);if(!fR||!bR)continue;const ratio=cr(blend(fR,bR),bR);const fs=parseFloat(getComputedStyle(p).fontSize);const fw=parseInt(getComputedStyle(p).fontWeight)||400;const isLarge=fs>=18||(fs>=14&&fw>=700);const req=isLarge?3:4.5;if(ratio<req)contrastFailures.push({text:nd.textContent.trim().slice(0,40),fg,bg,ratio:Math.round(ratio*100)/100,fontSize:fs+'px',required:req})}

  // ARIA
  const btnIssues=[];document.querySelectorAll('button,[role="button"]').forEach(el=>{if(el.getAttribute('aria-expanded')===null)btnIssues.push({text:(el.textContent||'').trim().slice(0,40),expanded:null,controls:el.getAttribute('aria-controls')})});
  const secIssues=[];document.querySelectorAll('section').forEach(el=>{if(!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby'))secIssues.push({id:el.id||'none',cls:el.className?.toString().slice(0,20)})});
  const decoIssues=[];document.querySelectorAll('canvas,svg').forEach(el=>{if(!el.closest('a,button')&&el.getAttribute('aria-hidden')!=='true')decoIssues.push({tag:el.tagName.toLowerCase(),cls:el.className?.toString?.()?.slice(0,20)||''})});

  // Motion
  let hasRMcss=false;try{for(const s of document.styleSheets){try{for(const r of s.cssRules){if(r instanceof CSSMediaRule&&r.conditionText?.includes('prefers-reduced-motion'))hasRMcss=true}}catch{}}}catch{}
  let hasRMjs=false;document.querySelectorAll('script:not([src])').forEach(s=>{if(s.textContent?.includes('prefers-reduced-motion'))hasRMjs=true});

  // Focus
  const focusable=Array.from(document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),[tabindex]:not([tabindex="-1"])')).filter(e=>getComputedStyle(e).display!=='none');
  const first=focusable[0];const hasSkip=first?.tagName==='A'&&(first.getAttribute('href')||'').startsWith('#')&&/skip|main/i.test(first.textContent||'');
  const noFocus=[];
  for(const el of focusable.slice(0,30)){const b={};['outlineStyle','outlineColor','outlineWidth','boxShadow','borderColor'].forEach(p=>b[p]=getComputedStyle(el)[p]);el.focus();const a={};['outlineStyle','outlineColor','outlineWidth','boxShadow','borderColor'].forEach(p=>a[p]=getComputedStyle(el)[p]);el.blur();if(!['outlineStyle','outlineColor','outlineWidth','boxShadow','borderColor'].some(p=>b[p]!==a[p]))noFocus.push(`<${el.tagName.toLowerCase()}> "${(el.textContent||'').trim().slice(0,30)}"`);}

  // Target size
  const below44=[];document.querySelectorAll('a[href],button,[role="button"]').forEach(el=>{const s=getComputedStyle(el);if(s.display==='none')return;if(el.tagName==='A'&&['p','li','span'].includes(el.parentElement?.tagName.toLowerCase()))return;const r=el.getBoundingClientRect();if(Math.min(r.width,r.height)<44)below44.push({tag:el.tagName.toLowerCase(),text:(el.textContent||'').trim().slice(0,30),w:Math.round(r.width),h:Math.round(r.height)})});

  return{contrastFailures,btnIssues,secIssues,decoIssues,hasRMcss,hasRMjs,hasSkip,noFocus,below44,totalFocusable:focusable.length};
});

await browser.close();

// Build the data message
let msg = `Page: ${url}\n\n`;
msg += `## STAGE 1: axe-core (${axe.length} violations)\n`;
for(const v of axe) msg += `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} elements, WCAG: ${v.wcagTags.join(',')})\n`;
msg += `\n## STAGE 2a: Contrast — ${stage2.contrastFailures.length} failures\n`;
for(const f of stage2.contrastFailures) msg += `FAIL: "${f.text}" ratio=${f.ratio}:1 (need ${f.required}:1) fg=${f.fg} bg=${f.bg}\n`;
msg += `\n## STAGE 2b: ARIA — ${stage2.btnIssues.length} buttons missing aria-expanded, ${stage2.secIssues.length} sections without name, ${stage2.decoIssues.length} decorative not hidden\n`;
for(const b of stage2.btnIssues) msg += `Button: "${b.text}" expanded=${b.expanded} controls=${b.controls}\n`;
for(const s of stage2.secIssues) msg += `Section: id=${s.id} class=${s.cls} — no accessible name\n`;
for(const d of stage2.decoIssues) msg += `<${d.tag}> class="${d.cls}" — not hidden from AT\n`;
msg += `\n## STAGE 2c: Motion — reducedMotion CSS=${stage2.hasRMcss} JS=${stage2.hasRMjs}\n`;
msg += `\n## STAGE 2d: Focus — skipLink=${stage2.hasSkip}, ${stage2.noFocus.length} without focus style, ${stage2.totalFocusable} total focusable\n`;
for(const e of stage2.noFocus) msg += `No focus: ${e}\n`;
msg += `\n## STAGE 2e: Target Size — ${stage2.below44.length} below 44px\n`;
for(const t of stage2.below44) msg += `<${t.tag}> "${t.text}" ${t.w}x${t.h}px\n`;

msg += `\n## FLAGS\n`;
if(stage2.contrastFailures.length) msg += `- ${stage2.contrastFailures.length} contrast failures\n`;
if(stage2.btnIssues.length) msg += `- ${stage2.btnIssues.length} buttons missing ARIA\n`;
if(stage2.secIssues.length) msg += `- ${stage2.secIssues.length} sections without name\n`;
if(stage2.decoIssues.length) msg += `- ${stage2.decoIssues.length} decorative not hidden\n`;
if(!stage2.hasSkip) msg += `- No skip link\n`;
if(stage2.noFocus.length) msg += `- ${stage2.noFocus.length} elements without focus style\n`;
if(!stage2.hasRMcss && !stage2.hasRMjs) msg += `- No prefers-reduced-motion\n`;
if(stage2.below44.length) msg += `- ${stage2.below44.length} targets below 44px\n`;
msg += `\nVerify each issue with verify_violation. Report ALL.`;

console.log(`\n=== Data message: ${msg.length} chars, ~${Math.ceil(msg.length/4)} tokens ===\n`);

// Stage 4: Send to OpenAI
console.log('=== Sending to gpt-4o ===\n');
const startTime = Date.now();

const client = new OpenAI({ apiKey });

const PROMPT = `You are WCAG Scout. You receive audit data and produce an accessibility report. For each issue, call verify_violation to confirm it against the WCAG spec. Group by severity (critical/serious/moderate/minor). Output valid markdown. Be concise.`;

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: PROMPT },
    { role: 'user', content: msg },
  ],
  tools: [{
    type: 'function',
    function: {
      name: 'verify_violation',
      description: 'Verify a finding against WCAG spec',
      parameters: {
        type: 'object',
        properties: {
          finding: { type: 'string' },
          sc_id: { type: 'string' },
        },
        required: ['finding', 'sc_id'],
      },
    },
  }],
  tool_choice: 'auto',
});

const elapsed = Date.now() - startTime;
console.log(`First response in ${elapsed}ms`);
console.log(`Finish reason: ${response.choices[0].finish_reason}`);

const firstMsg = response.choices[0].message;
if (firstMsg.tool_calls?.length) {
  console.log(`Tool calls requested: ${firstMsg.tool_calls.length}`);
  for (const tc of firstMsg.tool_calls) {
    console.log(`  ${tc.function.name}(${tc.function.arguments.slice(0,80)}...)`);
  }
} else {
  console.log(`\n=== FINAL RESPONSE ===\n`);
  console.log(firstMsg.content?.slice(0, 2000));
}
