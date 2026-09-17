import { and, desc, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db, deals, merchants, merchantSources } from "@college-events/db";
import { DEAL_CATEGORIES, FRESHNESS_STATUSES } from "@college-events/core";
import { getCurrentUniversity } from "@/lib/current-university";
import { runDealsIngestAction, runDealsProcessAction, runDealsQueueAction } from "@/lib/deals-actions";

const ELIGIBILITY_BADGE: Record<string, string> = {
  feed_worthy: "badge-green",
  story_worthy: "badge-blue",
  evergreen_library: "badge-purple",
  reject: "badge-muted",
};

const FRESHNESS_BADGE: Record<string, string> = {
  new: "badge-green",
  expiring_soon: "badge-amber",
  updated: "badge-blue",
  active: "badge-blue",
  recurring: "badge-purple",
  unknown: "badge-muted",
  expired: "badge-red",
};

const VERIFICATION_BADGE: Record<string, string> = {
  verified: "badge-green",
  high_confidence: "badge-blue",
  needs_review: "badge-amber",
  stale: "badge-red",
  rejected: "badge-muted",
};

export const dynamic = "force-dynamic";

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; freshness?: string; eligibility?: string; minScore?: string; merchant?: string }>;
}) {
  const params = await searchParams;
  const university = await getCurrentUniversity();
  const today = new Date().toISOString().slice(0, 10);

  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(deals)
    .where(eq(deals.universityId, university.id));

  const [newTodayRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.universityId, university.id), sql`${deals.dateDiscovered}::date = ${today}::date`));

  const [feedWorthyRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.universityId, university.id), eq(deals.contentEligibility, "feed_worthy")));

  const [storyWorthyRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.universityId, university.id), eq(deals.contentEligibility, "story_worthy")));

  const [expiringSoonRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.universityId, university.id), eq(deals.freshnessStatus, "expiring_soon")));

  const [needsVerificationRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.universityId, university.id), eq(deals.verificationStatus, "needs_review")));

  const [activeMerchantsRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(merchants)
    .where(and(eq(merchants.universityId, university.id), eq(merchants.active, true)));

  // A source is "failing" once it's been checked at least once but its last
  // check didn't succeed (lastSuccessfulCheckAt is stale relative to
  // lastCheckedAt, or missing entirely) — the deals-product analog of
  // events' sources.consecutiveFailures >= 3 tile.
  const failingSources = await db
    .select({ source: merchantSources, merchant: merchants })
    .from(merchantSources)
    .innerJoin(merchants, eq(merchantSources.merchantId, merchants.id))
    .where(
      and(
        eq(merchants.universityId, university.id),
        isNotNull(merchantSources.lastCheckedAt),
        or(isNull(merchantSources.lastSuccessfulCheckAt), lt(merchantSources.lastSuccessfulCheckAt, merchantSources.lastCheckedAt)),
      ),
    );

  const filters = [eq(deals.universityId, university.id)];
  if (params.category) filters.push(eq(deals.dealCategory, params.category as (typeof deals.dealCategory.enumValues)[number]));
  if (params.freshness) filters.push(eq(deals.freshnessStatus, params.freshness as (typeof deals.freshnessStatus.enumValues)[number]));
  if (params.eligibility)
    filters.push(eq(deals.contentEligibility, params.eligibility as (typeof deals.contentEligibility.enumValues)[number]));
  if (params.minScore) filters.push(gte(deals.qualityScore, Number(params.minScore)));

  const rows = await db
    .select({ deal: deals, merchant: merchants })
    .from(deals)
    .innerJoin(merchants, eq(deals.merchantId, merchants.id))
    .where(and(...filters, params.merchant ? sql`${merchants.name} ILIKE ${"%" + params.merchant + "%"}` : sql`true`))
    .orderBy(desc(deals.qualityScore))
    .limit(200);

  const isFiltered = !!(params.category || params.freshness || params.eligibility || params.minScore || params.merchant);

  return (
    <>
      <h1>{university.name} — Deals</h1>
      <p className="subtitle">
        {university.city}, {university.state} · {university.timezone} · {university.dealsInstagramAccount ?? "no deals IG account set"}
      </p>

      <div className="stat-row">
        <div className="stat-card">
          <div className="value">{totalRow?.total ?? 0}</div>
          <div className="label">Total deals</div>
        </div>
        <div className="stat-card">
          <div className="value">{newTodayRow?.total ?? 0}</div>
          <div className="label">New deals today</div>
        </div>
        <div className="stat-card">
          <div className="value">{feedWorthyRow?.total ?? 0}</div>
          <div className="label">Feed-worthy</div>
        </div>
        <div className="stat-card">
          <div className="value">{storyWorthyRow?.total ?? 0}</div>
          <div className="label">Story-worthy</div>
        </div>
        <div className="stat-card">
          <div className="value">{expiringSoonRow?.total ?? 0}</div>
          <div className="label">Expiring soon</div>
        </div>
        <div className="stat-card">
          <div className="value">{needsVerificationRow?.total ?? 0}</div>
          <div className="label">Needs verification</div>
        </div>
        <div className="stat-card">
          <div className="value">{activeMerchantsRow?.total ?? 0}</div>
          <div className="label">Active merchants</div>
        </div>
        <div className="stat-card">
          <div className="value">{failingSources.length}</div>
          <div className="label">Source failures</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Pipeline controls</h2>
          <a href="/deals/queue">this week&apos;s content queue →</a>
        </div>
        <div style={{ padding: 16 }} className="btn-row">
          <form action={runDealsIngestAction}>
            <button className="btn" type="submit">
              1. Check merchant sources for changes
            </button>
          </form>
          <form action={runDealsProcessAction}>
            <button className="btn btn-primary" type="submit">
              2. Extract / score / dedupe pending deals
            </button>
          </form>
          <form action={runDealsQueueAction}>
            <button className="btn" type="submit">
              3. Build weekly content queue
            </button>
          </form>
        </div>
        <p style={{ padding: "0 16px 16px", color: "var(--muted)", fontSize: 12 }}>
          In production these run on a schedule per merchant tier (Tier A daily, Tier B 2-3x/week, Tier C weekly).
          These buttons are for on-demand runs during development/demo.
        </p>
      </div>

      {failingSources.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <h2 style={{ margin: 0 }}>Source failures</h2>
          </div>
          <div style={{ padding: "0 16px 14px" }}>
            {failingSources.map(({ source, merchant }) => (
              <div key={source.id} style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                <strong style={{ color: "var(--red)" }}>{merchant.name}</strong> — {source.sourceUrl}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="btn-row" style={{ marginBottom: 16 }}>
        <a className="btn" href="/deals">
          All
        </a>
        <a className="btn" href="/deals?eligibility=feed_worthy">
          Feed-worthy
        </a>
        <a className="btn" href="/deals?eligibility=story_worthy">
          Story-worthy
        </a>
        <a className="btn" href="/deals?eligibility=evergreen_library">
          Evergreen library
        </a>
        <a className="btn" href="/deals?freshness=expiring_soon">
          Expiring soon
        </a>
        <a className="btn" href="/deals?minScore=80">
          Score 80+
        </a>
      </div>

      <form style={{ marginBottom: 16 }} className="btn-row">
        <select name="category" defaultValue={params.category ?? ""}>
          <option value="">All categories</option>
          {DEAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select name="freshness" defaultValue={params.freshness ?? ""}>
          <option value="">All freshness</option>
          {FRESHNESS_STATUSES.map((f) => (
            <option key={f} value={f}>
              {f.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input name="merchant" placeholder="Filter by merchant name" defaultValue={params.merchant ?? ""} />
        <button className="btn" type="submit">
          Filter
        </button>
      </form>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Deal</th>
              <th>Merchant</th>
              <th>Category</th>
              <th>Distance</th>
              <th>Score</th>
              <th>Freshness</th>
              <th>Verification</th>
              <th>Eligibility</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ deal, merchant }) => (
              <tr key={deal.id}>
                <td>
                  <strong>{deal.title}</strong>
                  <div style={{ fontSize: 11, color: "var(--muted)", maxWidth: 320 }}>{deal.cleanOfferDescription}</div>
                </td>
                <td>{merchant.name}</td>
                <td>{deal.dealCategory.replace(/_/g, " ")}</td>
                <td>{merchant.distanceFromCampusMiles.toFixed(1)}mi</td>
                <td>{deal.qualityScore}</td>
                <td>
                  <span className={`badge ${FRESHNESS_BADGE[deal.freshnessStatus] ?? "badge-muted"}`}>
                    {deal.freshnessStatus.replace(/_/g, " ")}
                  </span>
                </td>
                <td>
                  <span className={`badge ${VERIFICATION_BADGE[deal.verificationStatus] ?? "badge-muted"}`}>
                    {deal.verificationStatus.replace(/_/g, " ")}
                  </span>
                </td>
                <td>
                  <span className={`badge ${ELIGIBILITY_BADGE[deal.contentEligibility] ?? "badge-muted"}`}>
                    {deal.contentEligibility.replace(/_/g, " ")}
                  </span>
                </td>
                <td>{deal.expirationDate ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="empty">
                  No deals match this filter{isFiltered ? "" : " — run the pipeline controls above"}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
