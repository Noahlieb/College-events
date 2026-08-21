export type GlyphPathCommand =
  | { type: "M" | "L"; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "Z" };

export interface GlyphOutline {
  advanceWidth: number;
  commands: GlyphPathCommand[];
}

export interface GlyphFont {
  unitsPerEm: number;
  glyphs: Record<string, GlyphOutline>;
}
