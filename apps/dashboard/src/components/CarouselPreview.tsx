"use client";

import { useState } from "react";

export interface CarouselSlide {
  id: string;
  url: string;
  alt: string;
}

/**
 * Instagram-carousel preview: one big frame plus a thumbnail strip to jump
 * between slides. Previously built as a pure-CSS trick (a hidden radio per
 * slide position, wired to its thumbnail/frame via `:nth-of-type(N)` rules
 * in globals.css) — that only worked up to however many `:nth-of-type`
 * rules were hardcoded, which is exactly the kind of cap the post-builder
 * is no longer supposed to have on slide count. A small stateful component
 * has no such ceiling — it works the same whether a post has 3 slides or
 * 300, and `.ig-thumbs`'s existing `overflow-x: auto` already handles a
 * thumbnail strip too wide to fit on screen.
 */
export function CarouselPreview({ slides }: { slides: CarouselSlide[] }) {
  const [active, setActive] = useState(0);
  const current = Math.min(active, slides.length - 1);

  return (
    <>
      <div className="ig-image-frame">
        {slides.map((s, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={s.id} src={s.url} alt={s.alt} className="slide-image" style={{ display: i === current ? "block" : "none" }} />
        ))}
      </div>
      <div className="ig-thumbs">
        {slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActive(i)}
            className="thumb-label"
            style={{
              padding: 0,
              cursor: "pointer",
              borderColor: i === current ? "var(--accent)" : "transparent",
              opacity: i === current ? 1 : 0.55,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.url} alt={s.alt} />
          </button>
        ))}
      </div>
    </>
  );
}
