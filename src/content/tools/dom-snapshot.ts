import type {
  DomSnapshotParams,
  DomSnapshotResult,
  DomSnapshotNode,
} from '@shared/tool-types';

// ──────────────────────────────────────────────
// get_dom_snapshot
//
// Why not just send innerHTML?
//   A typical page has 5,000-50,000 lines of HTML. Sending all
//   of that to an LLM would:
//   1. Blow past the token limit
//   2. Cost a fortune
//   3. Be mostly noise (inline styles, SVG paths, script tags)
//
// What we do instead:
//   Walk the DOM tree and build a SIMPLIFIED representation:
//   - Only include semantically meaningful elements
//   - Capture roles, ARIA attributes, text content
//   - Skip decorative/scripting elements entirely
//   - Limit depth to prevent explosion on deeply nested pages
//
// This gives the LLM a "structural X-ray" of the page —
// enough to spot missing landmarks, heading issues, and
// ARIA pattern problems without drowning in noise.
// ──────────────────────────────────────────────

// Tags we skip entirely — they add no accessibility info
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'svg', 'path', 'link',
  'meta', 'br', 'hr', 'wbr',
]);

// Tags we always include — they carry semantic meaning
const SEMANTIC_TAGS = new Set([
  'main', 'nav', 'header', 'footer', 'aside', 'section', 'article',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'form', 'input', 'select', 'textarea', 'button', 'label',
  'a', 'img', 'video', 'audio', 'canvas',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'ul', 'ol', 'li',
  'dialog', 'details', 'summary',
]);

export function getDomSnapshot(params: DomSnapshotParams): DomSnapshotResult {
  const selector = params.selector || 'body';
  const maxDepth = params.maxDepth ?? 5;

  const root = document.querySelector(selector);
  if (!root) {
    return {
      root: { tag: 'NOT_FOUND', textContent: `No element matching: ${selector}` },
      landmarkCount: 0,
      headingCount: 0,
    };
  }

  let landmarkCount = 0;
  let headingCount = 0;

  function walk(el: Element, depth: number): DomSnapshotNode | null {
    const tag = el.tagName.toLowerCase();

    // Skip non-semantic elements
    if (SKIP_TAGS.has(tag)) return null;

    // Skip hidden elements — they're not exposed to assistive tech
    if (el.getAttribute('aria-hidden') === 'true') return null;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;

    // Count landmarks and headings for the summary
    const role = el.getAttribute('role') || getImplicitRole(tag);
    if (isLandmarkRole(role)) landmarkCount++;
    if (/^h[1-6]$/.test(tag)) headingCount++;

    // Build the node
    const node: DomSnapshotNode = { tag };

    // Include role if it's explicit or a landmark
    if (el.getAttribute('role')) node.role = el.getAttribute('role')!;
    else if (isLandmarkRole(role)) node.role = role ?? undefined;

    // ARIA attributes
    if (el.getAttribute('aria-label')) node.ariaLabel = el.getAttribute('aria-label') ?? undefined;
    if (el.getAttribute('aria-labelledby')) node.ariaLabelledBy = el.getAttribute('aria-labelledby') ?? undefined;

    // ID (useful for aria-labelledby references)
    if (el.id) node.id = el.id;

    // Classes (trimmed — just the first few for identification)
    if (el.className && typeof el.className === 'string') {
      node.classes = el.className.split(/\s+/).slice(0, 3).join(' ');
    }

    // Text content (only for leaf-ish elements — avoid duplicating
    // text that will appear in children)
    if (isLeafLike(el) || SEMANTIC_TAGS.has(tag)) {
      const text = getDirectText(el).trim();
      if (text) node.textContent = text.slice(0, 100);
    }

    // Recurse into children (respecting depth limit)
    if (depth < maxDepth) {
      const children: DomSnapshotNode[] = [];
      for (const child of el.children) {
        const childNode = walk(child, depth + 1);
        if (childNode) children.push(childNode);
      }
      if (children.length > 0) node.children = children;
    }

    // Skip this node if it has no semantic value AND no children
    // (e.g., an empty <div> wrapper)
    if (!SEMANTIC_TAGS.has(tag) && !node.role && !node.ariaLabel && !node.children) {
      return null;
    }

    return node;
  }

  const snapshotRoot = walk(root, 0) ?? { tag: 'empty' };

  return {
    root: snapshotRoot,
    landmarkCount,
    headingCount,
  };
}

// ─── Helpers ─────────────────────────────────

function getImplicitRole(tag: string): string | null {
  // Maps HTML tags to their default ARIA roles
  const map: Record<string, string> = {
    main: 'main',
    nav: 'navigation',
    header: 'banner',
    footer: 'contentinfo',
    aside: 'complementary',
    section: 'region',
    article: 'article',
    form: 'form',
    a: 'link',
    button: 'button',
    input: 'textbox',
    select: 'combobox',
    textarea: 'textbox',
    img: 'img',
    table: 'table',
    dialog: 'dialog',
  };
  return map[tag] ?? null;
}

function isLandmarkRole(role: string | null): boolean {
  if (!role) return false;
  return [
    'banner', 'navigation', 'main', 'contentinfo',
    'complementary', 'region', 'form', 'search',
  ].includes(role);
}

// Returns true for elements that typically contain text directly
function isLeafLike(el: Element): boolean {
  return el.children.length === 0 || /^(h[1-6]|p|span|a|button|label|li|td|th|summary)$/.test(
    el.tagName.toLowerCase()
  );
}

// Gets only the DIRECT text of an element (not text from children)
// This avoids duplicating text that will appear in child nodes
function getDirectText(el: Element): string {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
    }
  }
  return text;
}
