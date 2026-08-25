/**
 * Event artwork generation.
 *
 * Kept behind an interface for the usual reason — providers change — but
 * also because the *rules* around generation matter more than the provider
 * does, and they need one place to live. Generated art is a last resort,
 * permitted only when every source has been asked and none of them had
 * anything real.
 */

export interface ArtworkEventFacts {
  id: string;
  name: string;
  category: string;
  /** Venue name, for atmosphere only — never rendered into the image. */
  venue: string | null;
  city: string | null;
  /** ISO start, used for season/time-of-day feel, never drawn as text. */
  startAt: string;
  description: string | null;
}

export interface GeneratedEventAsset {
  /** Raw image bytes. Storage is the caller's concern. */
  image: Buffer;
  mime: string;
  width: number;
  height: number;
  provider: string;
  model: string;
  /** The exact prompt used, stored so a bad image can be explained. */
  prompt: string;
  generatedAt: Date;
}

export interface EventArtworkGenerator {
  readonly name: string;
  readonly model: string;
  generate(event: ArtworkEventFacts): Promise<GeneratedEventAsset>;
}

/**
 * Thrown when generation is attempted for an event that already has real
 * artwork. This is a programming error rather than a runtime condition —
 * the caller was supposed to check — so it throws instead of returning a
 * result a caller might ignore.
 */
export class OfficialVisualExistsError extends Error {
  constructor(eventId: string) {
    super(`AI artwork generation prohibited: official visual exists for event ${eventId}`);
    this.name = "OfficialVisualExistsError";
  }
}

/** Thrown when generation is attempted before every source has been asked. */
export class AssetDiscoveryIncompleteError extends Error {
  constructor(eventId: string) {
    super(
      `AI artwork generation prohibited: asset discovery has not completed for event ${eventId} — ` +
        "another source may still supply a real flyer",
    );
    this.name = "AssetDiscoveryIncompleteError";
  }
}

/** Square source art; the slide renderer crops to its own aspect. */
export const ARTWORK_WIDTH = 1024;
export const ARTWORK_HEIGHT = 1024;

/**
 * Builds the generation prompt.
 *
 * The most important thing here is what it does *not* ask for. The model
 * is asked for a background visual only — no text, no dates, no venue
 * names, no layout. All of those are rendered deterministically afterwards
 * by the slide renderer, which cannot misspell a venue or invent a date.
 * Asking an image model to lay out a finished Instagram slide is how you
 * ship a post that says "SATRUDAY".
 */
export function buildArtworkPrompt(event: ArtworkEventFacts): string {
  const start = new Date(event.startAt);
  const month = Number.isNaN(start.getTime())
    ? "the season"
    : start.toLocaleDateString("en-US", { month: "long" });
  const hour = Number.isNaN(start.getTime()) ? 20 : start.getUTCHours();
  const timeOfDay = hour >= 18 || hour < 5 ? "night-time" : hour >= 12 ? "afternoon" : "morning";

  const mood: Record<string, string> = {
    nightlife: "moody neon-lit club atmosphere, deep shadows, saturated magenta and violet light",
    party: "energetic celebratory atmosphere, warm confetti-like light bokeh",
    concert: "stage-lit concert hall atmosphere, dramatic beams of coloured light, haze",
    sports: "bold athletic stadium atmosphere, dramatic floodlight, strong diagonal energy",
    campus: "bright collegiate outdoor atmosphere, warm daylight, open architectural space",
    student_org: "friendly collaborative indoor atmosphere, warm approachable light",
    food_drink: "warm inviting culinary atmosphere, rich amber tones, soft depth of field",
    fitness: "dynamic athletic atmosphere, crisp cool light, sense of motion",
    comedy: "warm intimate club atmosphere, spotlight pooling on a dark stage",
    festival: "expansive open-air festival atmosphere, golden hour light, colourful haze",
    career: "clean professional atmosphere, cool neutral light, modern architectural lines",
    academic: "calm scholarly atmosphere, soft natural light, considered composition",
    community: "welcoming communal atmosphere, warm natural light",
  };

  return [
    "Abstract atmospheric background artwork for an event poster.",
    mood[event.category] ?? "vibrant contemporary atmosphere, rich colour, cinematic light",
    `${timeOfDay} feel, ${month} season.`,
    "Cinematic, high production value, richly coloured, suitable as a backdrop.",
    // Stated as a hard requirement rather than a preference: the
    // deterministic renderer owns every word on the finished slide.
    "ABSOLUTELY NO text, letters, numbers, words, signage, logos, watermarks or writing of any kind.",
    "No recognisable real people, no faces, no celebrity likenesses, no copyrighted characters or brands.",
    "Leave the lower third visually calm and uncluttered for text overlay.",
  ].join(" ");
}

/**
 * Facts whose change should invalidate existing generated artwork.
 *
 * Deliberately narrow. Regenerating because a description was tidied costs
 * money and changes a post someone may already have approved; these are
 * the facts that genuinely change what the picture should look like.
 */
export function artworkInputFingerprint(event: ArtworkEventFacts): string {
  return [event.name.trim().toLowerCase(), event.category, event.startAt.slice(0, 10)].join("|");
}
