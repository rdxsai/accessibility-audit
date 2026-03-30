import type {
  ComputedStylesParams,
  ComputedStylesResult,
} from '@shared/tool-types';

// ──────────────────────────────────────────────
// get_computed_styles
//
// Why this tool exists:
//   axe-core missed the contrast issue on nav links with
//   rgba(208, 207, 200, 0.5) because alpha-blending against
//   a dark background is hard to compute from CSS values alone.
//
// What this tool does:
//   Uses getComputedStyle() to get the BROWSER'S resolved values.
//   The browser has already done the alpha blending, inheritance,
//   CSS variable resolution, etc. We just read the final answer.
//
//   We also compute the contrast ratio ourselves, so the LLM
//   doesn't have to do math (LLMs are bad at math).
// ──────────────────────────────────────────────

export function getComputedStyles(
  params: ComputedStylesParams
): ComputedStylesResult {
  const el = document.querySelector(params.selector) as HTMLElement | null;

  if (!el) {
    return {
      found: false,
      selector: params.selector,
      color: '',
      backgroundColor: '',
      contrastRatio: null,
      fontSize: '',
      fontWeight: '',
      outlineStyle: '',
      outlineColor: '',
      outlineWidth: '',
      opacity: '',
      isVisible: false,
    };
  }

  const style = getComputedStyle(el);

  // Get the foreground color (already resolved by the browser)
  const fgColor = style.color;

  // Get the effective background color. This is tricky:
  // getComputedStyle gives us THIS element's background, but if it's
  // transparent, the visible background comes from a parent.
  // We walk up the tree to find the first opaque background.
  const bgColor = getEffectiveBackgroundColor(el);

  // Compute contrast ratio from the resolved colors
  const fgRgb = parseRgb(fgColor);
  const bgRgb = parseRgb(bgColor);
  const contrastRatio =
    fgRgb && bgRgb ? computeContrastRatio(fgRgb, bgRgb) : null;

  const isVisible =
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    el.offsetWidth > 0 &&
    el.offsetHeight > 0;

  return {
    found: true,
    selector: params.selector,
    color: fgColor,
    backgroundColor: bgColor,
    contrastRatio: contrastRatio ? Math.round(contrastRatio * 100) / 100 : null,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    outlineStyle: style.outlineStyle,
    outlineColor: style.outlineColor,
    outlineWidth: style.outlineWidth,
    opacity: style.opacity,
    isVisible,
  };
}

// ─── Background color resolution ─────────────
//
// CSS backgrounds can be transparent, semi-transparent, or absent.
// The actual color the user SEES is a blend of this element's bg
// with whatever is behind it. We walk up the DOM to find it.

function getEffectiveBackgroundColor(el: HTMLElement): string {
  let current: HTMLElement | null = el;

  while (current) {
    const bg = getComputedStyle(current).backgroundColor;
    const rgb = parseRgb(bg);

    // If this background is fully opaque, we found it
    if (rgb && rgb.a >= 1) {
      return bg;
    }

    // If it has some opacity, we'd need to blend with the parent's
    // background. For now, keep walking up.
    current = current.parentElement;
  }

  // If we reach the root and everything is transparent, assume white
  // (browser default background)
  return 'rgb(255, 255, 255)';
}

// ─── Color parsing and contrast math ─────────
//
// WCAG contrast ratio formula:
//   ratio = (L1 + 0.05) / (L2 + 0.05)
//   where L1 is the lighter relative luminance
//
// Relative luminance formula (from WCAG 2.2 spec):
//   For each channel (R, G, B):
//     sRGB = channel / 255
//     linear = sRGB <= 0.04045
//       ? sRGB / 12.92
//       : ((sRGB + 0.055) / 1.055) ^ 2.4
//   L = 0.2126 * R_linear + 0.7152 * G_linear + 0.0722 * B_linear

interface RgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseRgb(color: string): RgbColor | null {
  // Browser computed styles return "rgb(r, g, b)" or "rgba(r, g, b, a)"
  const match = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/
  );
  if (!match) return null;
  return {
    r: parseInt(match[1]),
    g: parseInt(match[2]),
    b: parseInt(match[3]),
    a: match[4] !== undefined ? parseFloat(match[4]) : 1,
  };
}

function relativeLuminance(rgb: RgbColor): number {
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
    const srgb = c / 255;
    return srgb <= 0.04045
      ? srgb / 12.92
      : Math.pow((srgb + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function computeContrastRatio(fg: RgbColor, bg: RgbColor): number {
  // If fg has alpha < 1, blend it against the bg
  const blended = blendAlpha(fg, bg);
  const l1 = relativeLuminance(blended);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function blendAlpha(fg: RgbColor, bg: RgbColor): RgbColor {
  // Alpha compositing: result = fg * alpha + bg * (1 - alpha)
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}
