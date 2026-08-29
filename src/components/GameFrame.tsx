// The security boundary of the whole site.
//
// The AI-authored game runs here and nowhere else. `sandbox="allow-scripts"`
// is granted alone and deliberately: WITHOUT `allow-same-origin` the frame
// gets an opaque origin, so it cannot touch the parent page, its storage,
// or any key a visitor may have typed. Do not add `allow-same-origin`,
// `allow-top-navigation` or `allow-popups` — together with allow-scripts
// they would let the frame escape the sandbox entirely.
//
// `srcDoc` (not `src`) keeps the document inline, so it inherits the
// sandbox rather than loading as a same-origin page.

export interface GameFrameProps {
  /** The AI-authored bundle, rendered inline via `srcDoc`. Never trusted. */
  html: string;
  /** Accessible name for the frame; also what screen readers announce. */
  title: string;
}

/** Renders the untrusted game inside its sandbox. */
export function GameFrame({ html, title }: GameFrameProps) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox="allow-scripts"
      className="h-full w-full border-0 bg-white"
    />
  );
}
