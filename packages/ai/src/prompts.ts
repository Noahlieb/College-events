import type {
  AnalyzeEventInput,
  AnalyzeFlyerInput,
  ClassifyEventInput,
  CompareDuplicatesInput,
  GenerateCaptionInput,
  ScoreEventAppealInput,
  SummarizeEventInput,
} from "./types.js";

const JSON_ONLY_RULE =
  "Respond with ONLY a single valid JSON object matching the schema below. No prose, no markdown fences, no explanation.";

export function analyzeEventPrompt(input: AnalyzeEventInput): { system: string; user: string } {
  const system = [
    `You extract structured event data for ${input.schoolContext.name} (${input.schoolContext.shortName}), a college in ${input.schoolContext.city}, ${input.schoolContext.state}.`,
    "You will be given raw text discovered from a source (social post caption, webpage text, or flyer OCR).",
    "If any field is ambiguous or not stated, return null for that field — NEVER guess or invent a value.",
    "Only set is_event to true if the text clearly describes a specific, dated/timed happening (not a generic ad, a recurring bio link, or unrelated chatter).",
    JSON_ONLY_RULE,
    `Schema: {"is_event":boolean,"event_name":string|null,"date":"YYYY-MM-DD"|null,"start_time":"HH:mm"|null,"end_time":"HH:mm"|null,"venue":string|null,"city":string|null,"price":string|null,"age_requirement":string|null,"category":one of [campus,student_org,sports,concert,nightlife,party,food_drink,fitness,comedy,festival,career,academic,networking,community,dating,other]|null,"organization":string|null,"description":string|null,"confidence":number between 0 and 1}`,
  ].join("\n");

  const user = [
    `Today's date: ${input.currentDate}`,
    `Source: ${input.sourceName} (${input.sourceType})`,
    input.sourceUrl ? `Source URL: ${input.sourceUrl}` : null,
    input.publishedAt ? `Published at: ${input.publishedAt}` : null,
    "",
    "Raw text:",
    input.caption ?? "(no caption)",
    input.ocrText ? `\nFlyer OCR text:\n${input.ocrText}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}

export function analyzeFlyerPrompt(input: AnalyzeFlyerInput): { system: string; user: string } {
  const system = [
    `You read event flyer images for ${input.schoolContext.name} (${input.schoolContext.shortName}).`,
    "First transcribe any readable text on the flyer, then extract structured event fields from it.",
    "If the image has no readable event text, set has_readable_text to false and leave extracted fields null.",
    JSON_ONLY_RULE,
    `Schema: {"has_readable_text":boolean,"ocr_text":string|null,"image_quality_score":number 0-1,"extracted":{"is_event":boolean,"event_name":string|null,"date":"YYYY-MM-DD"|null,"start_time":"HH:mm"|null,"end_time":"HH:mm"|null,"venue":string|null,"city":string|null,"price":string|null,"age_requirement":string|null,"category":string|null,"organization":string|null,"description":string|null,"confidence":number}}`,
  ].join("\n");
  const user = [
    `Today's date: ${input.currentDate}`,
    `Image URL: ${input.imageUrl}`,
    input.caption ? `Accompanying caption: ${input.caption}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

export function classifyEventPrompt(input: ClassifyEventInput): { system: string; user: string } {
  const system = [
    "Classify a college event into exactly one primary category and any additional relevant tags from the same fixed list.",
    "Categories: campus, student_org, sports, concert, nightlife, party, food_drink, fitness, comedy, festival, career, academic, networking, community, dating, other.",
    JSON_ONLY_RULE,
    `Schema: {"category": one of the categories, "tags": array of categories, "confidence": number 0-1}`,
  ].join("\n");
  const user = `Name: ${input.name}\nOrganization: ${input.organization ?? "unknown"}\nDescription: ${input.description ?? "none"}`;
  return { system, user };
}

export function scoreEventPrompt(input: ScoreEventAppealInput): { system: string; user: string } {
  const system = [
    `Rate how appealing this event is likely to be to a typical undergraduate at ${input.schoolContext.name}, independent of geography or cost (those are scored separately by our system).`,
    "Consider novelty, social draw, and how many students would plausibly want to attend.",
    JSON_ONLY_RULE,
    `Schema: {"appeal_score": number 0-100, "reasoning": short string}`,
  ].join("\n");
  const user = `Name: ${input.name}\nCategory: ${input.category}\nDescription: ${input.description ?? "none"}`;
  return { system, user };
}

export function summarizeEventPrompt(input: SummarizeEventInput): { system: string; user: string } {
  const maxWords = input.maxWords ?? 25;
  const system = [
    `Write a concise, factual one-sentence summary of this event in at most ${maxWords} words for an Instagram slide. No hashtags, no emoji, no hype language.`,
    JSON_ONLY_RULE,
    `Schema: {"summary": string}`,
  ].join("\n");
  const user = `Event: ${input.name}\nDetails: ${input.rawDescription}`;
  return { system, user };
}

/**
 * Few-shot reference for the campus lane. Real FAU caption the user
 * supplied as "make it look like this" — abstract format instructions were
 * tried first and consistently drifted on the details that matter (which
 * lines get a header, where the day emoji goes, exactly how the CTA block
 * reads); showing the model a caption that already has all of that right
 * holds format fidelity far better than describing the format in prose.
 */
const CAMPUS_CAPTION_EXAMPLE = `August 24 to 30 is packed with campus events, student orgs, and home games.

📚 MONDAY 8/24
• Welcome to Your Library #FirstDay, 11AM to 1PM
• Phi Beta Sigma Welcome Back BBQ, 6PM to 10PM

🎉 TUESDAY 8/25
• First-Gen Welcome Reception, 5PM to 7PM
• Hoot's Birthday Party, 5PM to 7PM

⚽ THURSDAY 8/27
• Women's Soccer vs Howard, 5PM
• Men's Soccer vs North Florida, 7:30PM

🏐 SATURDAY 8/29
• FAU Volleyball vs FIU, RED OUT, 2PM

Save this post so you don't miss anything 👀
Tag who you're going with ⬇️

Follow @fau.events for what's happening on and around campus every week.

#FAU #FloridaAtlantic #FAUOwls #FAUEvents`;

const NIGHTLIFE_CAPTION_EXAMPLE = `THIS WEEK IN FAU NIGHTLIFE 🦉🔥
Welcome Week is packed from Tuesday through Saturday.

🍸 TUESDAY 8/25
• Tipsy Tuesdays: Welcome Back FAU at One11 Boca

🎉 WEDNESDAY 8/26
• Bounce Welcome Week, 9PM
• Tryst Ladies Night, 9PM to 2AM

🔥 THURSDAY 8/27
• Bankrol Hayden at Tin Roof Fort Lauderdale, doors 10PM, 21+

🚌 FRIDAY 8/28
• FAU Party Bus to SWAY, pickup at FAU Student Union
• Party Rock Fridays at Bounce, 9PM

☀️ SATURDAY 8/29
• Disorientation Welcome Week Pool Party at Rock Bar Day Club, 12PM to 7PM, 21+

Save this post for the weekend 👀
Send it to your group chat and tag who you're going out with ⬇️

Follow @fau.events for FAU campus events, nightlife, sports, and things to do around Boca and Delray.

#FAU #FAUEvents #FAUNightlife #FloridaAtlantic #FAUOwls`;

export function generateCaptionPrompt(input: GenerateCaptionInput): { system: string; user: string } {
  const isNightlife = input.postType === "thursday_nightlife";
  const example = isNightlife ? NIGHTLIFE_CAPTION_EXAMPLE : CAMPUS_CAPTION_EXAMPLE;

  const system = [
    `Write an Instagram caption for ${input.schoolShortName}'s student events account, matching this EXACT reference caption's structure, tone, and formatting — down to the emoji placement, section spacing, and closing block. Only the words, emoji choices, and hashtags should change to fit the new school and event list below; the shape of the caption should not.`,
    "",
    "--- REFERENCE CAPTION ---",
    example,
    "--- END REFERENCE ---",
    "",
    "Structural rules, in order:",
    isNightlife
      ? '1. First line: an all-caps header in the exact shape "THIS WEEK IN {SCHOOL SHORT NAME} NIGHTLIFE" followed by two emoji that fit the school\'s mascot/vibe and nightlife energy.\n2. Second line: one short sentence previewing the week.'
      : "1. First line: one or two short sentences previewing the week, mentioning the date range and the kinds of events in it. No all-caps header on this lane.",
    "2. A blank line, then one section per day that actually has events, in chronological order, each shaped as:\n   {one emoji fitting that day's dominant event} {WEEKDAY} {M/D}\n   • {event}, {time}\n   Pick a different, well-fitting emoji per day — never reuse the same one twice unless nothing else fits. Only include venue in a bullet when it adds real information (nightlife events almost always name the venue; on-campus events usually don't need to).",
    "3. A blank line, then exactly the two-line CTA block in the reference's own wording style (adapt phrasing to feel natural, keep the same two-beat structure: a 'save this' line, then a 'tag/send to' line, each ending with the same kind of emoji the reference uses).",
    "4. A blank line, then a 'Follow @{instagram handle} for ...' line describing what the account posts, in the same voice as the reference (campus lane: what's happening on/around campus; nightlife lane: campus events, nightlife, sports, and things to do around the city).",
    "5. A blank line, then 4-5 hashtags relevant to the school and lane, space-separated, no commas.",
    "Never invent an event, day, time, or venue that isn't in the data given below. Use only the days that actually have events — skip any day with nothing on it entirely, do not pad it in.",
    JSON_ONLY_RULE,
    `Schema: {"caption": string, "hashtags": string[]}`,
  ].join("\n");

  const user = [
    `School: ${input.schoolName} (${input.schoolShortName}), ${input.city}`,
    `Instagram handle: ${input.instagramHandle}`,
    `Week: ${input.weekRangeLabel}`,
    "Events in this post, in chronological order (already grouped by day via dayLabel):",
    ...input.events.map((e, i) => `${i + 1}. [${e.dayLabel}] ${e.name}${e.venue ? ` — ${e.venue}` : ""} — ${e.time}`),
  ].join("\n");
  return { system, user };
}

export function compareDuplicatesPrompt(input: CompareDuplicatesInput): { system: string; user: string } {
  const system = [
    "Determine whether two independently-discovered event listings describe the SAME real-world event.",
    "Be conservative: only say true when you are confident, given name, venue, and timing.",
    JSON_ONLY_RULE,
    `Schema: {"is_duplicate": boolean, "confidence": number 0-1, "reasoning": short string}`,
  ].join("\n");
  const user = [
    `Event A: "${input.eventA.name}" at ${input.eventA.venue ?? "unknown venue"} on ${input.eventA.startAt}. ${input.eventA.description ?? ""}`,
    `Event B: "${input.eventB.name}" at ${input.eventB.venue ?? "unknown venue"} on ${input.eventB.startAt}. ${input.eventB.description ?? ""}`,
  ].join("\n");
  return { system, user };
}
