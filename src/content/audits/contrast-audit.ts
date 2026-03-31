import {
  parseRgb,
  blendAlpha,
  contrastRatio,
  getEffectiveBgColor,
  buildSelector,
} from './color-utils';

// ──────────────────────────────────────────────
// Contrast audit — walks EVERY visible text element.
//
// For each element with text:
//   1. Get foreground color via getComputedStyle
//   2. Walk ancestors to find the first opaque background
//   3. Alpha-blend foreground onto background
//   4. Compute WCAG relative luminance + contrast ratio
//   5. Determine threshold: 4.5:1 normal, 3:1 large text
//   6. Flag failures
//
// Deduplicates by (fgColor, bgColor) pair — no point
// reporting the same color combo 50 times. Capped at
// 200 unique combos to avoid choking on huge pages.
// ──────────────────────────────────────────────

export interface ContrastFinding {
  selector: string;
  text: string;             // first 60 chars
  fgColor: string;          // resolved rgb()
  bgColor: string;          // resolved rgb() after ancestor walk
  contrastRatio: number;
  fontSize: string;
  fontWeight: string;
  isLargeText: boolean;     // ≥18px or ≥14px bold
  requiredRatio: number;    // 4.5 or 3
  passes: boolean;
}

export interface ContrastAuditResult {
  totalTextElements: number;
  uniqueColorCombos: number;
  failures: ContrastFinding[];
  passes: number;
}

const MAX_UNIQUE_COMBOS = 200;

// Elements that never contain visible text
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'svg', 'path', 'meta', 'link',
  'br', 'hr', 'img', 'video', 'audio', 'canvas', 'iframe', 'object',
]);

export function runContrastAudit(): ContrastAuditResult {
  const failures: ContrastFinding[] = [];
  const seenCombos = new Set<string>();
  let totalTextElements = 0;
  let passes = 0;

  // TreeWalker is the most efficient way to visit every text node
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const text = node.textContent?.trim();
        if (!text || text.length === 0) return NodeFilter.FILTER_REJECT;

        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const tag = parent.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;

        // Skip aria-hidden elements
        if (parent.closest('[aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;

        // Skip invisible elements
        const style = getComputedStyle(parent);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0' ||
          parent.offsetWidth === 0 ||
          parent.offsetHeight === 0
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (seenCombos.size >= MAX_UNIQUE_COMBOS) break;

    const parent = node.parentElement!;
    totalTextElements++;

    const style = getComputedStyle(parent);
    const fgColor = style.color;
    const bgColor = getEffectiveBgColor(parent);

    // Deduplicate by color combo
    const comboKey = `${fgColor}|${bgColor}`;
    if (seenCombos.has(comboKey)) continue;
    seenCombos.add(comboKey);

    const fgRgb = parseRgb(fgColor);
    const bgRgb = parseRgb(bgColor);
    if (!fgRgb || !bgRgb) continue;

    const blended = blendAlpha(fgRgb, bgRgb);
    const ratio = contrastRatio(blended, bgRgb) as number;

    const fontSize = parseFloat(style.fontSize);
    const fontWeight = parseInt(style.fontWeight) || 400;
    const isLargeText = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700);
    const requiredRatio = isLargeText ? 3 : 4.5;
    const ok = ratio >= requiredRatio;

    if (ok) {
      passes++;
    } else {
      failures.push({
        selector: buildSelector(parent),
        text: (node.textContent?.trim() ?? '').slice(0, 60),
        fgColor,
        bgColor,
        contrastRatio: Math.round(ratio * 100) / 100,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        isLargeText,
        requiredRatio,
        passes: false,
      });
    }
  }

  return {
    totalTextElements,
    uniqueColorCombos: seenCombos.size,
    failures,
    passes,
  };
}

// Color math imported from ./color-utils.ts
