import { asc, eq } from "drizzle-orm";
import { db, dealContentPostDeals, dealContentPosts, deals, merchants } from "@college-events/db";
import { getCurrentUniversity } from "@/lib/current-university";
import { approveDealPostAction, rejectDealPostAction, runDealsQueueAction } from "@/lib/deals-actions";

const SLOT_LABEL: Record<string, string> = {
  monday_top5: "Monday · 5 Best Deals",
  tuesday_deal: "Tuesday · Deal of the Day",
  wednesday_local: "Wednesday · Local Deal of the Week",
  friday_weekend: "Friday · Weekend Deal",
  sunday_roundup: "Sunday · Roundup",
  story: "Story",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-muted",
  needs_review: "badge-amber",
  ready_for_approval: "badge-blue",
  approved: "badge-green",
  scheduled: "badge-purple",
  published: "badge-green",
  rejected: "badge-red",
};

export const dynamic = "force-dynamic";

export default async function DealsQueuePage() {
  const university = await getCurrentUniversity();

  const posts = await db
    .select()
    .from(dealContentPosts)
    .where(eq(dealContentPosts.universityId, university.id))
    .orderBy(asc(dealContentPosts.scheduledDate));

  const postDeals = await Promise.all(
    posts.map(async (post) => {
      const links = await db
        .select({ position: dealContentPostDeals.position, deal: deals, merchant: merchants })
        .from(dealContentPostDeals)
        .innerJoin(deals, eq(dealContentPostDeals.dealId, deals.id))
        .innerJoin(merchants, eq(deals.merchantId, merchants.id))
        .where(eq(dealContentPostDeals.postId, post.id))
        .orderBy(asc(dealContentPostDeals.position));
      return { post, links };
    }),
  );

  return (
    <>
      <h1>{university.name} — Weekly content queue</h1>
      <p className="subtitle">
        Proposed posts for the current week. Nothing here goes out automatically — approve or reject each one below
        (spec: human approval gate).
      </p>

      <div className="panel">
        <div style={{ padding: 16 }} className="btn-row">
          <form action={runDealsQueueAction}>
            <button className="btn btn-primary" type="submit">
              Rebuild this week&apos;s queue
            </button>
          </form>
          <a className="btn" href="/deals">
            ← back to deals inventory
          </a>
        </div>
      </div>

      {postDeals.length === 0 && (
        <div className="panel">
          <div className="empty">No content queue yet — run the pipeline from /deals, then rebuild the queue above.</div>
        </div>
      )}

      {postDeals
        .sort((a, b) => a.post.scheduledDate.localeCompare(b.post.scheduledDate))
        .map(({ post, links }) => (
          <div className="panel" key={post.id}>
            <div className="panel-header">
              <h2 style={{ margin: 0 }}>
                {SLOT_LABEL[post.slot] ?? post.slot} — {post.scheduledDate}
              </h2>
              <span className={`badge ${STATUS_BADGE[post.status] ?? "badge-muted"}`}>{post.status.replace(/_/g, " ")}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Deal</th>
                  <th>Merchant</th>
                  <th>Score</th>
                  <th>Eligibility</th>
                </tr>
              </thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.deal.id}>
                    <td>{l.position + 1}</td>
                    <td>
                      <strong>{l.deal.title}</strong>
                      <div style={{ fontSize: 11, color: "var(--muted)", maxWidth: 360 }}>{l.deal.cleanOfferDescription}</div>
                    </td>
                    <td>{l.merchant.name}</td>
                    <td>{l.deal.qualityScore}</td>
                    <td>{l.deal.contentEligibility.replace(/_/g, " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {["draft", "needs_review", "ready_for_approval"].includes(post.status) && (
              <div style={{ padding: 16 }} className="btn-row">
                <form action={approveDealPostAction.bind(null, post.id)}>
                  <button className="btn btn-primary btn-sm" type="submit">
                    Approve
                  </button>
                </form>
                <form action={rejectDealPostAction.bind(null, post.id)}>
                  <input type="hidden" name="reason" value="rejected from dashboard" />
                  <button className="btn btn-danger btn-sm" type="submit">
                    Reject
                  </button>
                </form>
              </div>
            )}
          </div>
        ))}
    </>
  );
}
