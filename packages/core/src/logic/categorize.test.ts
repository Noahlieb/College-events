import { describe, expect, it } from "vitest";
import { categorizeEvent } from "./categorize.js";

describe("categorizeEvent", () => {
  it("classifies a campus student org event", () => {
    const { category } = categorizeEvent({
      name: "Owl Central Involvement Fair",
      description: "Meet FAU student organizations on campus",
      organization: "FAU Student Involvement",
    });
    expect(category).toBe("campus");
  });

  it("classifies an FAU sports game", () => {
    const { category } = categorizeEvent({
      name: "FAU Owls Football vs. Georgia Southern",
      description: "Tailgate starts at 4pm, kickoff at 7pm",
    });
    expect(category).toBe("sports");
  });

  it("classifies a nightlife event over generic 'party' keywords when both present", () => {
    const { category, tags } = categorizeEvent({
      name: "College Night DJ Party at Bounce",
      description: "Bottle service specials and college night promo",
    });
    expect(category).toBe("nightlife");
    expect(tags).toContain("party");
  });

  it("classifies a nightlife afterparty that merely mentions 'the game' as nightlife, not sports", () => {
    const { category } = categorizeEvent({
      name: "Post-Game Bash @ Kemistry Nightclub",
      description: "DJ sets and bottle service all night — come celebrate the game with us!",
    });
    expect(category).toBe("nightlife");
  });

  it("still classifies a real game as sports even though it mentions a party", () => {
    const { category } = categorizeEvent({
      name: "FAU Owls Football vs. Georgia Southern",
      description: "Tailgate starts at 4pm, kickoff at 7pm — after-party details to come",
    });
    expect(category).toBe("sports");
  });

  it("falls back to 'other' when nothing matches", () => {
    const { category } = categorizeEvent({ name: "Untitled listing", description: "" });
    expect(category).toBe("other");
  });
});
