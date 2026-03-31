// Full end-to-end test: data collection + OpenAI tool loop + MCP verification
// Mirrors exactly what the extension does, but headlessly.

import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'https://rdxsai.vercel.app/';

const envFile = readFileSync(resolve(__dirname, '.env'), 'utf-8');
const apiKey = (envFile.match(/OPENAI_API_KEY=(.+)/)?.[1] || envFile.match(/OPEN_AI_API=(.+)/)?.[1])?.trim();
if (!apiKey) { console.error('No API key'); process.exit(1); }

// Stage 1-3: collect
console.log('=== STAGE 1-3: Collecting ===');
const t0 = Date.now();
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
const axeSource = readFileSync(resolve(__dirname, 'node_modules/axe-core/axe.min.js'), 'utf-8');
await page.evaluate(axeSource);

const dataMsg = await page.evaluate(async () => {
  // Mini versions of the audits inline
  const axe = await window.axe.run(document, { resultTypes: ['violations'] });
  const violations = axe.violations;

  let msg = `Page: ${location.href}\n\n## STAGE 1: axe-core (${violations.length} violations)\n`;
  for (const v of violations) {
    msg += `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} el, ${v.tags.filter(t=>t.startsWith('wcag')).join(',')})\n`;
    for (const n of v.nodes) msg += `  - ${n.target.join(' > ')}: ${n.html.slice(0,150)}\n`;
  }

  // Contrast
  function parseRgb(c){const m=c.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);return m?{r:+m[1],g:+m[2],b:+m[3],a:m[4]!==undefined?+m[4]:1}:null}
  function blend(f,b){const a=f.a;return{r:Math.round(f.r*a+b.r*(1-a)),g:Math.round(f.g*a+b.g*(1-a)),b:Math.round(f.b*a+b.b*(1-a)),a:1}}
  function lum(c){const[r,g,b]=[c.r,c.g,c.b].map(v=>{const s=v/255;return s<=.04045?s/12.92:Math.pow((s+.055)/1.055,2.4)});return .2126*r+.7152*g+.0722*b}
  function cr(a,b){const l1=lum(a),l2=lum(b);return(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)}
  function getBg(el){let c=el;while(c){const bg=getComputedStyle(c).backgroundColor;const rgb=parseRgb(bg);if(rgb&&rgb.a>=1)return bg;c=c.parentElement}return'rgb(255,255,255)'}

  const cFails=[];const seen=new Set();
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode(n){if(!n.textContent?.trim())return 2;const p=n.parentElement;if(!p||['script','style','svg','canvas'].includes(p.tagName.toLowerCase()))return 2;if(p.closest('[aria-hidden="true"]'))return 2;const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden')return 2;return 1}});
  let nd;while((nd=w.nextNode())&&seen.size<200){const p=nd.parentElement;const fg=getComputedStyle(p).color;const bg=getBg(p);const k=fg+'|'+bg;if(seen.has(k))continue;seen.add(k);const fR=parseRgb(fg),bR=parseRgb(bg);if(!fR||!bR)continue;const ratio=cr(blend(fR,bR),bR);const fs=parseFloat(getComputedStyle(p).fontSize);const fw=parseInt(getComputedStyle(p).fontWeight)||400;const isLarge=fs>=18||(fs>=14&&fw>=700);const req=isLarge?3:4.5;if(ratio<req)cFails.push({text:nd.textContent.trim().slice(0,40),ratio:Math.round(ratio*100)/100,required:req,fg,bg})}

  msg += `\n## STAGE 2a: Contrast — ${cFails.length} failures\n`;
  for(const f of cFails) msg += `FAIL: "${f.text}" ratio=${f.ratio}:1 (need ${f.required}:1) fg=${f.fg} bg=${f.bg}\n`;

  // ARIA (tight scoping)
  const btnIssues=[];
  document.querySelectorAll('button,[role="button"]').forEach(el=>{
    if(getComputedStyle(el).display==='none')return;
    const exp=el.getAttribute('aria-expanded');const ctrl=el.getAttribute('aria-controls');
    const text=(el.textContent||'').trim().slice(0,40);const issues=[];
    if(exp!==null&&ctrl===null)issues.push('has aria-expanded but no aria-controls');
    if(exp===null&&/^(expand|collapse|show|hide|toggle)\b/i.test(text))issues.push('suggests toggle but no aria-expanded');
    if(!text&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')&&!el.getAttribute('title'))issues.push('no accessible name');
    if(issues.length)btnIssues.push({text,issues:issues.join('; ')});
  });
  const secIssues=[];
  document.querySelectorAll('section').forEach(el=>{if(!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby'))secIssues.push({id:el.id||'none'})});
  const decoIssues=[];
  document.querySelectorAll('canvas,svg').forEach(el=>{if(el.closest('a,button'))return;if(el.getAttribute('aria-hidden')!=='true'&&!el.getAttribute('aria-label'))decoIssues.push({tag:el.tagName.toLowerCase()})});

  msg += `\n## STAGE 2b: ARIA — ${btnIssues.length} button issues, ${secIssues.length} sections, ${decoIssues.length} decorative\n`;
  for(const b of btnIssues)msg+=`Button "${b.text}": ${b.issues}\n`;
  for(const s of secIssues)msg+=`Section id=${s.id}: no accessible name\n`;
  for(const d of decoIssues)msg+=`<${d.tag}>: not hidden from AT\n`;

  // Motion
  let hasRM=false;try{for(const s of document.styleSheets){try{for(const r of s.cssRules)if(r instanceof CSSMediaRule&&r.conditionText?.includes('prefers-reduced-motion'))hasRM=true}catch{}}}catch{}
  msg+=`\n## STAGE 2c: Motion — prefers-reduced-motion=${hasRM}\n`;

  // Focus
  const focusable=Array.from(document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),[tabindex]:not([tabindex="-1"])')).filter(e=>getComputedStyle(e).display!=='none');
  const first=focusable[0];const hasSkip=first?.tagName==='A'&&(first.getAttribute('href')||'').startsWith('#')&&/skip|main/i.test(first.textContent||'');
  msg+=`\n## STAGE 2d: Focus — skipLink=${hasSkip}, ${focusable.length} focusable\n`;

  // Target size
  const below44=[];document.querySelectorAll('a[href],button,[role="button"]').forEach(el=>{const s=getComputedStyle(el);if(s.display==='none')return;if(el.tagName==='A'&&['p','li','span'].includes(el.parentElement?.tagName.toLowerCase()))return;const r=el.getBoundingClientRect();if(Math.min(r.width,r.height)<44)below44.push({text:(el.textContent||'').trim().slice(0,30),w:Math.round(r.width),h:Math.round(r.height)})});
  msg+=`\n## STAGE 2e: Target — ${below44.length} below 44px\n`;
  for(const t of below44)msg+=`"${t.text}" ${t.w}x${t.h}px\n`;

  msg+=`\nVerify each issue TYPE once. List every element. Do not summarize.`;
  return msg;
});
await browser.close();

console.log(`Collection: ${Date.now()-t0}ms`);
console.log(`Message: ${dataMsg.length} chars\n`);

// Stage 4: OpenAI with tool loop
console.log('=== STAGE 4: OpenAI ===');
const client = new OpenAI({ apiKey });

const PROMPT = `You are WCAG Scout. Analyze the audit data. Call verify_violation once per issue TYPE. List every failing element individually. Output valid markdown grouped by WCAG SC. Be concise.`;

const messages = [
  { role: 'system', content: PROMPT },
  { role: 'user', content: dataMsg },
];

const tools = [{
  type: 'function',
  function: {
    name: 'verify_violation',
    description: 'Verify a finding against WCAG spec',
    parameters: { type: 'object', properties: { finding: { type: 'string' }, sc_id: { type: 'string' } }, required: ['finding'] },
  },
}];

for (let loop = 0; loop < 5; loop++) {
  const t1 = Date.now();
  const resp = await client.chat.completions.create({ model: 'gpt-4o', messages, tools, tool_choice: 'auto' });
  const elapsed = Date.now() - t1;
  const msg = resp.choices[0].message;
  console.log(`Loop ${loop+1}: ${elapsed}ms, finish=${resp.choices[0].finish_reason}, tool_calls=${msg.tool_calls?.length || 0}`);

  if (msg.tool_calls?.length) {
    messages.push(msg);
    for (const tc of msg.tool_calls) {
      if (tc.type !== 'function') continue;
      const args = JSON.parse(tc.function.arguments || '{}');
      // Call MCP
      const r = await fetch('http://localhost:8000/api/tool', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tc.function.name, args }),
      });
      const result = await r.json();
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
    continue;
  }

  // Final
  console.log(`\nTotal time: ${Date.now()-t0}ms`);
  console.log(`\n=== REPORT (${msg.content.length} chars) ===\n`);
  console.log(msg.content);
  break;
}
