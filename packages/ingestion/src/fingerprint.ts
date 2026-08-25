import type { AdapterType } from "@college-events/core";

/**
 * Platform fingerprinting: given a URL and optionally the page behind it,
 * work out which adapter can read it.
 *
 * This is the piece that makes "add a university" a data operation. The
 * discovery service finds candidate URLs; the fingerprinter decides that
 * `knightconnect.ucf.edu/engage/events` is a CampusLabs install and can be
 * crawled by the adapter that already serves FAU. Nothing here knows about
 * any particular school, and it must stay that way — a detector keyed on a
 * university would be a scraper wearing a different hat.
 *
 * Evidence is returned alongside the verdict because a human approves
 * these. "Detected CampusLabs (0.95)" is not reviewable; "host matches
 * *.campuslabs.com, page links /engage/api/discovery" is.
 */

export interface Fingerprint {
  adapterType: AdapterType;
  /** 0..1. Above AUTO_APPROVE_CONFIDENCE a candidate may skip review. */
  confidence: number;
  evidence: string[];
}

/** Confidence at or above which a candidate can be auto-approved. */
export const AUTO_APPROVE_CONFIDENCE = 0.9;

interface Signal {
  adapterType: AdapterType;
  confidence: number;
  evidence: string;
}

/** Host-based rules. A platform's own domain is the strongest signal there
 * is — nothing else is served from it. */
const HOST_RULES: { pattern: RegExp; adapterType: AdapterType; confidence: number; label: string }[] = [
  { pattern: /(^|\.)campuslabs\.com$/i, adapterType: "campuslabs", confidence: 0.97, label: "campuslabs.com host" },
  { pattern: /(^|\.)campusgroups\.com$/i, adapterType: "campusgroups", confidence: 0.97, label: "campusgroups.com host" },
  { pattern: /(^|\.)localist\.com$/i, adapterType: "localist", confidence: 0.95, label: "localist.com host" },
  { pattern: /(^|\.)25live\.collegenet\.com$/i, adapterType: "25live", confidence: 0.97, label: "25live.collegenet.com host" },
  { pattern: /(^|\.)sidearmsports\.com$/i, adapterType: "sidearm", confidence: 0.95, label: "sidearmsports.com host" },
  { pattern: /(^|\.)eventbrite\.(com|co\.uk|ca)$/i, adapterType: "eventbrite", confidence: 0.97, label: "eventbrite host" },
  { pattern: /(^|\.)posh\.vip$/i, adapterType: "posh", confidence: 0.97, label: "posh.vip host" },
  { pattern: /(^|\.)partiful\.com$/i, adapterType: "partiful", confidence: 0.97, label: "partiful.com host" },
  { pattern: /(^|\.)lu\.ma$/i, adapterType: "luma", confidence: 0.97, label: "lu.ma host" },
  { pattern: /(^|\.)ticketmaster\.(com|ca)$/i, adapterType: "ticketmaster", confidence: 0.97, label: "ticketmaster host" },
  { pattern: /(^|\.)tixr\.com$/i, adapterType: "tixr", confidence: 0.97, label: "tixr.com host" },
  { pattern: /(^|\.)google\.com$/i, adapterType: "google_calendar", confidence: 0.6, label: "google.com host" },
];

/** Path-based rules, applied when the host is the university's own. */
const PATH_RULES: { pattern: RegExp; adapterType: AdapterType; confidence: number; label: string }[] = [
  { pattern: /\/engage(\/|$)/i, adapterType: "campuslabs", confidence: 0.7, label: "/engage path" },
  { pattern: /\/25live(\/|$)/i, adapterType: "25live", confidence: 0.8, label: "/25live path" },
  { pattern: /\.ics(\?|$)/i, adapterType: "ical", confidence: 0.95, label: ".ics extension" },
  { pattern: /\/(feed|rss)(\/|\.xml|$)/i, adapterType: "rss", confidence: 0.8, label: "feed/rss path" },
];

/** HTML body/head markers. Weaker individually, decisive in combination. */
const HTML_RULES: { pattern: RegExp; adapterType: AdapterType; confidence: number; label: string }[] = [
  { pattern: /campuslabs\.com|\/engage\/api\/discovery/i, adapterType: "campuslabs", confidence: 0.9, label: "CampusLabs API reference" },
  { pattern: /campusgroups\.com|cg-?widget/i, adapterType: "campusgroups", confidence: 0.85, label: "CampusGroups markup" },
  { pattern: /<meta[^>]+name=["']generator["'][^>]+Localist/i, adapterType: "localist", confidence: 0.92, label: "Localist generator meta" },
  { pattern: /platform\.localist\.com|localist-widget/i, adapterType: "localist", confidence: 0.85, label: "Localist widget" },
  { pattern: /collegenet|series25|25live/i, adapterType: "25live", confidence: 0.8, label: "CollegeNET/Series25 reference" },
  { pattern: /__NUXT_DATA__[\s\S]{0,4000}sidearm|sidearmsports/i, adapterType: "sidearm", confidence: 0.9, label: "SIDEARM Nuxt payload" },
  { pattern: /<meta[^>]+name=["']generator["'][^>]+WordPress/i, adapterType: "wordpress", confidence: 0.85, label: "WordPress generator meta" },
  { pattern: /\/wp-content\/|\/wp-json\//i, adapterType: "wordpress", confidence: 0.7, label: "wp-content/wp-json paths" },
  { pattern: /calendar\.google\.com/i, adapterType: "google_calendar", confidence: 0.85, label: "Google Calendar embed" },
];

/** True when the document itself is a feed rather than a page. */
function detectFeedDocument(body: string): Signal | null {
  const head = body.slice(0, 1000);
  if (/^\s*BEGIN:VCALENDAR/im.test(head)) {
    return { adapterType: "ical", confidence: 0.98, evidence: "document is an iCalendar file" };
  }
  if (/<rss[\s>]/i.test(head)) {
    return { adapterType: "rss", confidence: 0.97, evidence: "document is an RSS feed" };
  }
  if (/<feed[^>]+xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(head)) {
    return { adapterType: "rss", confidence: 0.95, evidence: "document is an Atom feed" };
  }
  return null;
}

/** A linked alternate feed is a strong hint even on an ordinary page. */
function detectLinkedFeeds(body: string): Signal[] {
  const out: Signal[] = [];
  if (/<link[^>]+type=["']application\/rss\+xml["']/i.test(body)) {
    out.push({ adapterType: "rss", confidence: 0.6, evidence: "page links an RSS alternate" });
  }
  if (/<link[^>]+type=["']text\/calendar["']|href=["'][^"']+\.ics["']/i.test(body)) {
    out.push({ adapterType: "ical", confidence: 0.6, evidence: "page links an iCalendar feed" });
  }
  return out;
}

/**
 * schema.org Event JSON-LD. Checked last: it says a page *describes* events
 * without saying what platform it runs on, so a specific platform match
 * should always win over it.
 */
export function hasJsonLdEvents(body: string): boolean {
  for (const match of body.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const raw = match[1];
    if (!raw) continue;
    // A regex on the raw text is enough and survives the malformed JSON
    // that real pages ship; parsing would throw away otherwise-usable
    // evidence.
    if (/"@type"\s*:\s*(\[[^\]]*)?["'][A-Za-z]*Event/i.test(raw)) return true;
  }
  return false;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return "";
  }
}

/**
 * Identify the platform behind a URL.
 *
 * `body` is optional so a candidate can be fingerprinted from its URL
 * alone during discovery, then re-fingerprinted with the page once fetched.
 * Signals are combined rather than taken first-match: several weak hints
 * for the same platform legitimately add up, while the strongest single
 * signal still sets the floor.
 */
export function fingerprintUrl(url: string, body?: string): Fingerprint {
  const signals: Signal[] = [];
  const host = hostOf(url);
  const path = pathOf(url);

  if (host) {
    for (const rule of HOST_RULES) {
      if (rule.pattern.test(host)) {
        signals.push({ adapterType: rule.adapterType, confidence: rule.confidence, evidence: rule.label });
      }
    }
  }
  for (const rule of PATH_RULES) {
    if (rule.pattern.test(path)) {
      signals.push({ adapterType: rule.adapterType, confidence: rule.confidence, evidence: rule.label });
    }
  }

  if (body) {
    const feed = detectFeedDocument(body);
    if (feed) signals.push(feed);
    signals.push(...detectLinkedFeeds(body));
    for (const rule of HTML_RULES) {
      if (rule.pattern.test(body)) {
        signals.push({ adapterType: rule.adapterType, confidence: rule.confidence, evidence: rule.label });
      }
    }
    if (hasJsonLdEvents(body)) {
      signals.push({ adapterType: "jsonld", confidence: 0.65, evidence: "schema.org Event JSON-LD present" });
    }
  }

  if (signals.length === 0) {
    return {
      adapterType: "generic_web",
      confidence: body ? 0.2 : 0.1,
      evidence: [body ? "no platform markers found in page" : "no platform markers in URL"],
    };
  }

  // Score per platform: the strongest signal sets the floor, and each
  // additional independent signal for the same platform adds a diminishing
  // amount. Two weak hints agreeing is meaningfully better than one.
  const byType = new Map<AdapterType, Signal[]>();
  for (const signal of signals) {
    const list = byType.get(signal.adapterType) ?? [];
    list.push(signal);
    byType.set(signal.adapterType, list);
  }

  let best: Fingerprint | null = null;
  for (const [adapterType, group] of byType) {
    const sorted = [...group].sort((a, b) => b.confidence - a.confidence);
    let confidence = sorted[0]!.confidence;
    for (const extra of sorted.slice(1)) {
      confidence += (1 - confidence) * extra.confidence * 0.5;
    }
    confidence = Math.min(0.99, confidence);
    if (!best || confidence > best.confidence) {
      best = { adapterType, confidence, evidence: sorted.map((s) => s.evidence) };
    }
  }
  return best!;
}

/**
 * Fetches a URL and fingerprints the response.
 *
 * A page we cannot read is reported as `generic_web` with the reason as
 * evidence — never as a failure, and never retried aggressively. Discovery
 * inspects a lot of unfamiliar hosts, and a candidate that declines to be
 * read is simply a candidate a human should look at.
 */
export async function fingerprintPage(
  url: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Fingerprint> {
  try {
    const res = await fetchImpl(url, { headers: { Accept: "text/html,application/xhtml+xml" }, signal });
    if (!res.ok) {
      return {
        adapterType: fingerprintUrl(url).adapterType,
        confidence: 0.15,
        evidence: [`page returned HTTP ${res.status}; classified from URL only`],
      };
    }
    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const fingerprint = fingerprintUrl(url, body);

    if (/text\/calendar/i.test(contentType)) {
      return { adapterType: "ical", confidence: 0.98, evidence: ["text/calendar content type"] };
    }
    if (/application\/(rss|atom)\+xml/i.test(contentType)) {
      return { adapterType: "rss", confidence: 0.97, evidence: ["RSS/Atom content type"] };
    }
    return fingerprint;
  } catch (err) {
    return {
      adapterType: fingerprintUrl(url).adapterType,
      confidence: 0.1,
      evidence: [`could not fetch page: ${(err as Error).message}`],
    };
  }
}
