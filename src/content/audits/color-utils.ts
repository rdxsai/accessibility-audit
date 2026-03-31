// ──────────────────────────────────────────────
// Shared color math — used by contrast-audit and focus-audit.
//
// Implements the WCAG 2.2 relative luminance formula
// and contrast ratio calculation, plus alpha blending
// and background color resolution.
// ──────────────────────────────────────────────

export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseRgb(color: string): Rgb | null {
  const m = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/
  );
  if (!m) return null;
  return {
    r: parseInt(m[1]),
    g: parseInt(m[2]),
    b: parseInt(m[3]),
    a: m[4] !== undefined ? parseFloat(m[4]) : 1,
  };
}

export function blendAlpha(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

export function luminance(rgb: Rgb): number {
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Walk up ancestors to find the first opaque background color
export function getEffectiveBgColor(el: HTMLElement): string {
  let current: HTMLElement | null = el;
  while (current) {
    const bg = getComputedStyle(current).backgroundColor;
    const rgb = parseRgb(bg);
    if (rgb && rgb.a >= 1) return bg;
    current = current.parentElement;
  }
  return 'rgb(255, 255, 255)';
}

export function buildSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const cls =
    el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
  const parent = el.parentElement;
  if (parent) {
    const parentTag = parent.id ? `#${parent.id}` : parent.tagName.toLowerCase();
    return `${parentTag} > ${tag}${cls}`;
  }
  return `${tag}${cls}`;
}
