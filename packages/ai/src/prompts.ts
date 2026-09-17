import type {
  AnalyzeDealInput,
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

export function generateCaptionPrompt(input: GenerateCaptionInput): { system: string; user: string } {
  const bucketVoice: Record<GenerateCaptionInput["postType"], string> = {
    monday_campus:
      "upbeat, campus-community tone (this is the Monday 'This Week at [School]' post — campus events, student orgs and Owls athletics only)",
    // Retained only so historical posts with this type still generate a
    // caption; no schedule slot produces it any more.
    midweek_activities: "energetic tone for sports/concerts/things-to-do (legacy midweek post)",
    thursday_nightlife:
      "fun, weekend-hype tone (this is the Thursday nightlife/weekend guide post — nightlife only, never campus or sports)",
    custom: "clear, useful tone",
  };
  const system = [
    `Write a concise Instagram caption (3-5 short lines, no more than ~60 words) for a ${input.schoolShortName} student events account.`,
    `Voice: ${bucketVoice[input.postType]}.`,
    "End with a light call-to-action (e.g. 'save this post', 'which one are you going to?').",
    "Do not fabricate details not present in the event list. Only include a few relevant hashtags if they clearly help discovery — otherwise return an empty hashtags array.",
    JSON_ONLY_RULE,
    `Schema: {"caption": string, "hashtags": string[]}`,
  ].join("\n");
  const user = [
    `School: ${input.schoolName} (${input.schoolShortName})`,
    "Events in this post:",
    ...input.events.map((e, i) => `${i + 1}. ${e.name} — ${e.venue ?? "TBD"} — ${e.date}`),
  ].join("\n");
  return { system, user };
}

export function extractDealPrompt(input: AnalyzeDealInput): { system: string; user: string } {
  const system = [
    `You extract structured deal/promotion data for a business near ${input.universityContext.name} (${input.universityContext.shortName}), a college in ${input.universityContext.city}, ${input.universityContext.state}.`,
    "You will be given text pulled from a merchant's own specials/menu/rewards page or social post.",
    "Only set is_deal to true if the text clearly describes a specific, actionable promotion (a price, a discount, BOGO, a free item, or a named recurring special) — not a generic ad, a menu with no promo, or unrelated chatter.",
    "Prioritize deals students can act on today/this week/this month over vague permanent claims.",
    "NEVER invent a price, discount amount, expiration date, or day of week that isn't stated — leave the field null/empty instead. If the offer is a standing weekly special (e.g. 'Taco Tuesday every week'), set recurring true and fill valid_days_of_week; do not invent an expiration_date for it.",
    JSON_ONLY_RULE,
    `Schema: {"is_deal":boolean,"title":string|null,"deal_category":one of [food_restaurant,coffee_cafe,dessert,fast_casual,pizza_wings,bar_nightlife,fitness,beauty_barber_nails,entertainment,housing,retail_services,other]|null,"clean_offer_description":string|null,"normal_price":string|null,"deal_price":string|null,"discount_percent":number|null,"discount_dollars":number|null,"is_bogo":boolean,"is_free_item":boolean,"student_id_required":boolean,"promo_code":string|null,"valid_days_of_week":number[] (0=Sunday..6=Saturday),"start_date":"YYYY-MM-DD"|null,"expiration_date":"YYYY-MM-DD"|null,"start_time":"HH:mm"|null,"end_time":"HH:mm"|null,"recurring":boolean,"recurrence_pattern":string|null,"location_restrictions":string|null,"minimum_purchase":string|null,"eligibility":string|null,"confidence":number between 0 and 1}`,
  ].join("\n");

  const user = [
    `Today's date: ${input.currentDate}`,
    `Merchant: ${input.merchantName} (${input.merchantCategory})`,
    `Source: ${input.sourceType}`,
    input.sourceUrl ? `Source URL: ${input.sourceUrl}` : null,
    "",
    "Raw text:",
    input.rawText ?? "(no text)",
  ]
    .filter(Boolean)
    .join("\n");

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
