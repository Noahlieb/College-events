import type { DiscoveredItem, FetchContext, SourceAdapter } from "./types.js";
import { IngestionError } from "./types.js";

/**
 * SIDEARM Sports powers the athletics site for hundreds of NCAA schools
 * (FAU included — fausports.com). The current generation of those sites is
 * a Nuxt 3 SPA: schedules are rendered client-side from a Pinia store, and
 * the page ships zero schema.org/Event JSON-LD, so genericWebpageAdapter
 * (jsonld.ts) finds nothing there.
 *
 * Nuxt still server-renders the full page on first load and embeds the
 * hydration state as a flattened array in a `<script id="__NUXT_DATA__">`
 * tag — every value (primitive, object, or array) gets its own slot, and
 * containers reference child values by index instead of nesting them
 * inline. That means the complete schedule (opponent, date, time, location,
 * result, media links) is sitting in the plain HTML response to a normal
 * GET request; no browser/JS execution is needed to read it, matching spec
 * §9's preference for structured endpoints over rendered-DOM scraping.
 */

type NuxtValue = unknown;
type NuxtArray = NuxtValue[];

const NUXT_REF_WRAPPER_TAGS = new Set(["Reactive", "ShallowReactive", "Ref", "ShallowRef"]);

/**
 * Resolves one slot of Nuxt's flattened `__NUXT_DATA__` payload back into an
 * ordinary JS value. Exported for testing against hand-built fixtures.
 */
export function resolveNuxtPayload(arr: NuxtArray, index: number, cache = new Map<number, unknown>()): unknown {
  if (cache.has(index)) return cache.get(index);
  const raw = arr[index];

  if (raw === null || typeof raw !== "object") {
    return raw; // primitive leaf — strings/numbers/booleans/null get their own slot, unreferenced further
  }

  if (Array.isArray(raw)) {
    const [tag, ...rest] = raw as [unknown, ...number[]];
    if (typeof tag === "string" && NUXT_REF_WRAPPER_TAGS.has(tag)) {
      const resolved = resolveNuxtPayload(arr, rest[0]!, cache);
      cache.set(index, resolved);
      return resolved;
    }
    if (tag === "Set") {
      const resolved = new Set(rest.map((i) => resolveNuxtPayload(arr, i, cache)));
      cache.set(index, resolved);
      return resolved;
    }
    if (tag === "Map") {
      const entries: [unknown, unknown][] = [];
      for (let i = 0; i < rest.length; i += 2) {
        entries.push([resolveNuxtPayload(arr, rest[i]!, cache), resolveNuxtPayload(arr, rest[i + 1]!, cache)]);
      }
      const resolved = new Map(entries);
      cache.set(index, resolved);
      return resolved;
    }
    // plain array of index references
    const out: unknown[] = [];
    cache.set(index, out); // guards against self-referential cycles
    for (const i of raw as number[]) out.push(resolveNuxtPayload(arr, i, cache));
    return out;
  }

  // plain object: every field value is an index reference
  const out: Record<string, unknown> = {};
  cache.set(index, out);
  for (const [key, valueIndex] of Object.entries(raw as Record<string, number>)) {
    out[key] = resolveNuxtPayload(arr, valueIndex, cache);
  }
  return out;
}

/** Extracts and fully resolves the `__NUXT_DATA__` payload from a Nuxt-rendered HTML page. */
export function extractNuxtPayload(html: string): Record<string, unknown> | null {
  const match = /<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) return null;
  let arr: NuxtArray;
  try {
    arr = JSON.parse(match[1]!.trim());
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const resolved = resolveNuxtPayload(arr, 0);
  return resolved && typeof resolved === "object" ? (resolved as Record<string, unknown>) : null;
}

function getPiniaStore(payload: Record<string, unknown> | null, storeId: string): Record<string, unknown> | null {
  const pinia = payload?.pinia as Record<string, unknown> | undefined;
  const store = pinia?.[storeId];
  return store && typeof store === "object" ? (store as Record<string, unknown>) : null;
}

interface SidearmSport {
  shortname: string;
  title: string;
  non_sport?: boolean;
  scheduleId?: number | null;
}

interface SidearmOpponent {
  title?: string;
  image?: { fullpath?: string | null } | null;
}

interface SidearmResult {
  status?: string; // "W" | "L" | "T" | ...
  team_score?: string;
  opponent_score?: string;
  boxscore?: { url?: string | null } | null;
}

interface SidearmGame {
  id: number;
  date?: string | null; // local ISO-ish, e.g. "2026-08-20T19:00:00"
  time?: string | null; // e.g. "7:00 PM"
  location?: string | null;
  location_indicator?: string | null; // "H" | "A" | "N"
  at_vs?: string | null; // "vs" | "at"
  game_state_display?: string | null;
  game_center_link?: string | null;
  event_image?: string | null;
  opponent?: SidearmOpponent | null;
  result?: SidearmResult | null;
}

/** Every non-exhibition sport with its own schedule, discovered from any page's shared layout state. */
function discoverSports(payload: Record<string, unknown> | null): SidearmSport[] {
  const store = getPiniaStore(payload, "sports");
  const sports = (store?.sports as SidearmSport[] | undefined) ?? [];
  return sports.filter((s) => !s.non_sport && s.scheduleId != null && s.shortname);
}

/** Flattens every schedule the page's `schedule` store holds into a single games list. */
function extractGames(payload: Record<string, unknown> | null): SidearmGame[] {
  const store = getPiniaStore(payload, "schedule");
  const schedules = (store?.schedules as Record<string, { games?: SidearmGame[] }> | undefined) ?? {};
  return Object.values(schedules).flatMap((s) => s.games ?? []);
}

function formatResult(result: SidearmResult): string | null {
  if (!result.team_score || !result.opponent_score) return null;
  const outcome = result.status === "W" ? "Win" : result.status === "L" ? "Loss" : "Final";
  return `${outcome} ${result.team_score}-${result.opponent_score}`;
}

function toDiscoveredItem(sportTitle: string, origin: string, game: SidearmGame): DiscoveredItem {
  const opponent = game.opponent?.title ?? "TBD";
  const result = game.result ? formatResult(game.result) : null;
  const textParts = [
    `${sportTitle} ${game.at_vs ?? "vs"} ${opponent}`,
    game.date ? `Start: ${game.date}` : null,
    game.location ? `Location: ${game.location}` : null,
    result ? `Result: ${result}` : null,
  ].filter(Boolean);

  const sourceUrl = game.game_center_link
    ? `${origin}${game.game_center_link}`
    : game.result?.boxscore?.url
      ? `${origin}${game.result.boxscore.url}`
      : null;

  return {
    externalId: `sidearm-game-${game.id}`,
    sourceUrl,
    rawText: textParts.join("\n"),
    // null (no opponent logo/event graphic — e.g. multi-team tournament
    // entries) is the correct, honest value here: packages/render's
    // generatePlaceholderBackground already supplies a deterministic
    // category-tinted graphic downstream for events with no source photo.
    mediaUrl: game.opponent?.image?.fullpath ?? game.event_image ?? null,
    publishedAt: null,
    rawMetadata: {
      sport: sportTitle,
      opponent,
      atVs: game.at_vs ?? null,
      date: game.date ?? null,
      time: game.time ?? null,
      location: game.location ?? null,
      locationIndicator: game.location_indicator ?? null,
      gameState: game.game_state_display ?? null,
      result: game.result ?? null,
    },
  };
}

async function fetchHtml(url: string, fetchImpl: typeof fetch, sourceId: string): Promise<string> {
  const res = await fetchImpl(url, { headers: { Accept: "text/html" } });
  if (!res.ok) throw new IngestionError(`Athletics page fetch failed: HTTP ${res.status} (${url})`, sourceId);
  return res.text();
}

/**
 * SIDEARM Sports athletics adapter. Point `source.url` at any page on the
 * site (e.g. the composite `/calendar`) — the sports list lives in shared
 * layout state present on every page, so one fetch discovers every sport,
 * then each sport's `/sports/{shortname}/schedule` page is fetched for its
 * full game list. A single sport's page failing doesn't sink the run; only
 * total discovery failure (bad URL, unrecognized page structure) throws.
 */
export const sidearmAthleticsAdapter: SourceAdapter = {
  supportedTypes: ["athletics"],
  async fetchNew(ctx: FetchContext): Promise<DiscoveredItem[]> {
    if (!ctx.source.url) {
      throw new IngestionError("Athletics source has no URL configured", ctx.source.id);
    }
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const origin = new URL(ctx.source.url).origin;

    const indexHtml = await fetchHtml(ctx.source.url, fetchImpl, ctx.source.id);
    const sports = discoverSports(extractNuxtPayload(indexHtml));
    if (sports.length === 0) {
      throw new IngestionError(
        "No sports discovered on athletics site — page structure may have changed",
        ctx.source.id,
      );
    }
    const items: DiscoveredItem[] = [];
    for (const sport of sports) {
      let html: string;
      try {
        html = await fetchHtml(`${origin}/sports/${sport.shortname}/schedule`, fetchImpl, ctx.source.id);
      } catch {
        continue;
      }
      const games = extractGames(extractNuxtPayload(html));
      for (const game of games) items.push(toDiscoveredItem(sport.title, origin, game));
    }

    return ctx.maxItems ? items.slice(0, ctx.maxItems) : items;
  },
};
