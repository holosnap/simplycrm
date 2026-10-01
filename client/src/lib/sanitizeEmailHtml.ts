import DOMPurify from "dompurify";

// DOMPurify strips scripts/event handlers/javascript: URIs by default — that
// covers XSS. It does NOT by default block external resource loads (remote
// <img src>, CSS @import/url(), etc.) since that's a privacy leak (read
// receipts, IP logging via tracking pixels), not XSS, so that's handled here
// with an explicit attribute hook instead. The hook (and the hook-removal
// below) is scoped to a single sanitize() call rather than left as global
// DOMPurify state, since multiple thread messages can be rendered at once,
// each with its own independent "load remote images" toggle.
const REMOTE_URL_ATTRS = new Set(["src", "href", "poster", "background"]);

function isRemoteUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("ftp://")
  );
}

export function sanitizeEmailHtml(rawHtml: string, { allowRemoteContent }: { allowRemoteContent: boolean }): string {
  const blockRemoteAttr = (node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
    if (allowRemoteContent) return;
    if (!REMOTE_URL_ATTRS.has(data.attrName)) return;
    if (!isRemoteUrl(data.attrValue)) return;
    data.keepAttr = false;
    node.setAttribute(`data-blocked-${data.attrName}`, data.attrValue);
  };

  // `style` attributes can carry `url(...)` for a remote background image —
  // strip the whole attribute when not allowing remote content rather than
  // trying to parse/rewrite the CSS.
  const blockRemoteStyle = (_node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
    if (allowRemoteContent) return;
    if (data.attrName !== "style") return;
    if (/url\s*\(/i.test(data.attrValue)) {
      data.keepAttr = false;
    }
  };

  DOMPurify.addHook("uponSanitizeAttribute", blockRemoteAttr);
  DOMPurify.addHook("uponSanitizeAttribute", blockRemoteStyle);
  try {
    return DOMPurify.sanitize(rawHtml, {
      WHOLE_DOCUMENT: false,
      FORBID_TAGS: ["style", "link", "base", "meta", "iframe", "object", "embed", "form"],
      FORBID_ATTR: ["srcset"],
    });
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute", blockRemoteAttr);
    DOMPurify.removeHook("uponSanitizeAttribute", blockRemoteStyle);
  }
}
