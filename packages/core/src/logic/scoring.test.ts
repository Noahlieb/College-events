import { describe, expect, it } from "vitest";
import { scoreEvent } from "./scoring.js";

describe("scoreEvent", () => {
  it("scores a free, on-campus, campus-affiliated event very high for Monday and very low for Thursday nightlife", () => {
    const scores = scoreEvent({
      category: "campus",
      distanceMiles: 0.2,
      priceText: "Free",
      isCampusAffiliated: true,
      daysUntilStart: 3,
    });
    expect(scores.mondayCampus).toBeGreaterThan(85);
    expect(scores.mondayCampus).toBeGreaterThan(scores.thursdayNightlife);
    expect(scores.thursdayNightlife).toBeLessThan(20);
  });

  it("scores a Delray nightlife event high for Thursday and low for Monday campus", () => {
    const scores = scoreEvent({
      category: "nightlife",
      distanceMiles: 8,
      priceText: "Free before 11",
      isCampusAffiliated: false,
      daysUntilStart: 4,
    });
    expect(scores.thursdayNightlife).toBeGreaterThan(70);
    expect(scores.thursdayNightlife).toBeGreaterThan(scores.mondayCampus);
  });

  it("penalizes distant Miami events relative to an identical Boca event", () => {
    const boca = scoreEvent({
      category: "concert",
      distanceMiles: 5,
      priceText: "$20",
      isCampusAffiliated: false,
      daysUntilStart: 10,
    });
    const miami = scoreEvent({
      category: "concert",
      distanceMiles: 45,
      priceText: "$20",
      isCampusAffiliated: false,
      daysUntilStart: 10,
    });
    expect(miami.overall).toBeLessThan(boca.overall);
  });

  it("scores recurring/generic listings lower than an equivalent one-time event", () => {
    const oneTime = scoreEvent({
      category: "food_drink",
      distanceMiles: 3,
      priceText: "Free",
      isCampusAffiliated: false,
      daysUntilStart: 5,
    });
    const recurring = scoreEvent({
      category: "food_drink",
      distanceMiles: 3,
      priceText: "Free",
      isCampusAffiliated: false,
      daysUntilStart: 5,
      isRecurring: true,
    });
    expect(recurring.overall).toBeLessThan(oneTime.overall);
  });

  it("lets a big-ticket concert still score reasonably despite non-trivial price", () => {
    const scores = scoreEvent({
      category: "concert",
      distanceMiles: 10,
      priceText: "$65",
      isCampusAffiliated: false,
      daysUntilStart: 20,
    });
    expect(scores.overall).toBeGreaterThan(50);
  });

  it("ranks events further out in time lower than an otherwise-identical near-term event", () => {
    const soon = scoreEvent({
      category: "sports",
      distanceMiles: 2,
      priceText: "Free",
      isCampusAffiliated: true,
      daysUntilStart: 2,
    });
    const later = scoreEvent({
      category: "sports",
      distanceMiles: 2,
      priceText: "Free",
      isCampusAffiliated: true,
      daysUntilStart: 45,
    });
    expect(later.overall).toBeLessThan(soon.overall);
  });
});
