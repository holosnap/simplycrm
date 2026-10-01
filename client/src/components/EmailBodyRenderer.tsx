import { useMemo, useRef, useState } from "react";
import { sanitizeEmailHtml } from "../lib/sanitizeEmailHtml";

interface EmailBodyRendererProps {
  bodyHtml: string | null;
  bodyText: string | null;
}

// Renders a message body inside a sandboxed iframe so sender-supplied CSS
// (and anything DOMPurify didn't catch) can never affect the rest of the
// app's page. `sandbox="allow-same-origin"` WITHOUT `allow-scripts` is the
// key bit: it lets the parent read `contentDocument` (to measure height) and
// still guarantees the iframe can never execute a script, no matter what
// sneaks into the sanitized HTML — the two properties aren't actually linked
// in the sandbox spec.
export function EmailBodyRenderer({ bodyHtml, bodyText }: EmailBodyRendererProps) {
  const [allowRemoteContent, setAllowRemoteContent] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(100);

  const hasSafeHtml = Boolean(bodyHtml && bodyHtml.trim().length > 0);

  const sanitized = useMemo(() => {
    if (!hasSafeHtml) return null;
    return sanitizeEmailHtml(bodyHtml!, { allowRemoteContent });
  }, [bodyHtml, hasSafeHtml, allowRemoteContent]);

  // Falls back to the plain text part when there's no HTML at all — not when
  // sanitization happens to strip everything, since a message that's just an
  // image or a single stripped <script> tag would otherwise render blank
  // when plain text is a perfectly good fallback.
  const useHtml = hasSafeHtml && sanitized !== null;

  const srcDoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:0;font-family:system-ui,sans-serif;">${sanitized ?? ""}</body></html>`,
    [sanitized],
  );

  function handleLoad() {
    const doc = iframeRef.current?.contentDocument;
    if (doc) setHeight(doc.body?.scrollHeight ?? 100);
  }

  if (!useHtml) {
    return <pre className="email-body-text">{bodyText || "(no content)"}</pre>;
  }

  return (
    <div className="email-body-html">
      <div className="email-remote-toggle">
        <label>
          <input
            type="checkbox"
            checked={allowRemoteContent}
            onChange={(e) => setAllowRemoteContent(e.target.checked)}
          />
          Load remote images
        </label>
      </div>
      <iframe
        ref={iframeRef}
        title="Email content"
        sandbox="allow-same-origin"
        srcDoc={srcDoc}
        onLoad={handleLoad}
        style={{ width: "100%", border: "none", height }}
      />
    </div>
  );
}
