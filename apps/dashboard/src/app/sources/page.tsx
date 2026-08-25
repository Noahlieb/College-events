import {
  entitiesWithSourceCounts,
  gatherCoverage,
  pendingCandidates,
  recommendSources,
  sourcesWithEntities,
} from "@college-events/db";
import { COVERAGE_CATEGORIES, adapterSupport, platformSupported, registeredAdapterTypes } from "@college-events/ingestion";
import { SOURCE_CATEGORIES, SOURCE_TYPES, ADAPTER_TYPES } from "@college-events/core";
import { getCurrentSchool, listUniversities } from "@/lib/current-school";
import { DiscoverSourcesButton } from "@/components/DiscoverSourcesButton";
import { addSourceAction, toggleSourceActiveAction } from "@/lib/actions";
import {
  addCandidateUrlAction,
  approveCandidateAction,
  discoverSourcesAction,
  rejectCandidateAction,
  runSourceNowAction,
  selectUniversityAction,
} from "@/lib/discovery-actions";

export const dynamic = "force-dynamic";
// Discovery makes ~75+ sequential external requests (search queries, plus
// a page fetch per candidate for fingerprinting). Vercel's default
// function timeout (10s Hobby / 60s Pro) is nowhere near enough; this asks
// for the platform maximum. Even that may not be sufficient for a large
// university's query set — see DiscoverSourcesButton for what happens if
// it still times out, and `pnpm worker discover <school>` for a run with
// no time limit at all.
export const maxDuration = 300;

const HEALTH_BADGE: Record<string, string> = {
  healthy: "badge-green",
  warning: "badge-amber",
  degraded: "badge-amber",
  failed: "badge-red",
  disabled: "badge-muted",
};

/**
 * Support status answers a different question from health: "can we read
 * this platform at all", versus "did the last read work". A detected
 * platform with no adapter is never shown as active — it would never
 * produce an event — and never as failed, which would blame the source
 * for a gap on our side.
 */
const SUPPORT_BADGE: Record<string, string> = {
  supported: "badge-green",
  no_adapter: "badge-purple",
  auth_required: "badge-blue",
  degraded: "badge-amber",
  blocked: "badge-red",
  disabled: "badge-muted",
};

const SUPPORT_LABEL: Record<string, string> = {
  supported: "Supported",
  no_adapter: "Not yet supported",
  auth_required: "Needs credential",
  degraded: "Access declined",
  blocked: "Blocked",
  disabled: "Off",
};

function ago(date: Date | null): string {
  if (!date) return "never";
  const hours = Math.floor((Date.now() - date.getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function pct(ratio: number | null): string {
  // A null ratio means "nothing to divide by yet" — a brand-new
  // university with no events, or a probe that has never run. Showing "—"
  // reads as a rendering glitch; "Not measured" says plainly that this is
  // an absence of data, not a bad number.
  return ratio === null ? "Not measured" : `${Math.round(ratio * 100)}%`;
}

export default async function SourcesPage() {
  const school = await getCurrentSchool();
  const universities = await listUniversities();

  const expected = COVERAGE_CATEGORIES.filter((c) => c.expected).map((c) => c.key);
  const categoryLabels = Object.fromEntries(COVERAGE_CATEGORIES.map((c) => [c.key, c.label]));
  const supportedAdapterTypes = new Set(registeredAdapterTypes());
  const [coverage, sourceRows, candidates, organizations, venues] = await Promise.all([
    gatherCoverage(school.id, expected, { supportedAdapterTypes }),
    sourcesWithEntities(school.id),
    pendingCandidates(school.id),
    entitiesWithSourceCounts(school.id, "organization"),
    entitiesWithSourceCounts(school.id, "venue"),
  ]);
  // Derived from coverage.gaps, so it always agrees with what the panel
  // above says is missing rather than recomputing gaps a second way.
  const recommendations = await recommendSources(school.id, coverage.gaps, categoryLabels);

  const degraded = sourceRows.filter((r) => r.source.healthStatus === "degraded");
  const attention = sourceRows.filter(
    (r) => r.source.active && ["warning", "failed"].includes(r.source.healthStatus),
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Sources</h1>
        <form action={selectUniversityAction}>
          <select name="schoolId" defaultValue={school.id}>
            {universities.map((u) => (
              <option key={u.id} value={u.id}>
                {u.shortName} — {u.name}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" type="submit" style={{ marginLeft: 8 }}>
            Switch
          </button>
        </form>
        <div style={{ marginLeft: "auto" }}>
          <DiscoverSourcesButton action={discoverSourcesAction} />
        </div>
      </div>
      <p className="subtitle">
        {sourceRows.length} sources for {school.shortName}. Adding a source — or a university — is a data
        change; no adapter code is written for either.
      </p>

      {/* ── Coverage ─────────────────────────────────────────────── */}
      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Coverage</h2>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            Observable coverage of what we set out to monitor — not a claim about every event that exists.
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {coverage.metrics.map((m) => (
              <tr key={m.key}>
                <td>
                  <strong>{m.label}</strong>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {m.outOf !== undefined ? `${m.value} / ${m.outOf}` : m.value}{" "}
                  <span style={{ color: "var(--muted)" }}>({pct(m.ratio)})</span>
                </td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{m.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {coverage.gaps.length > 0 && (
          <div style={{ padding: 16, fontSize: 12 }}>
            <strong>Not covered yet:</strong> {coverage.gaps.join(", ")}. Run discovery to look for these.
          </div>
        )}
      </div>

      {/* ── Recommendations ──────────────────────────────────────── */}
      {recommendations.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <h2 style={{ margin: 0 }}>Recommendations</h2>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              Derived from observable gaps — nothing here is created automatically.
            </span>
          </div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {recommendations.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span className={`badge ${r.priority === "high" ? "badge-red" : "badge-amber"}`}>
                  {r.priority === "high" ? "HIGH PRIORITY" : "MEDIUM PRIORITY"}
                </span>
                <div>
                  <strong>{r.title}</strong>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.reason}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Source candidates ────────────────────────────────────── */}
      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Source candidates ({candidates.length})</h2>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            Discovery proposes; it never creates a source. A wrong source pollutes the calendar quietly.
          </span>
        </div>
        {candidates.length === 0 ? (
          <p style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>
            Nothing waiting for review. &ldquo;Discover sources&rdquo; searches this university&rsquo;s
            ecosystem — with no search provider configured it will find nothing, which is expected.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Detected as</th>
                <th>Why</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.url}</div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {c.detectedAdapter ?? "unidentified"}
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {Math.round(c.confidence * 100)}% confident
                    </div>
                    {/* Approving a candidate whose platform we cannot read
                        produces a source that will never yield an event —
                        so say so before the click, not after. */}
                    <span
                      className={`badge ${platformSupported(c.detectedAdapter) ? "badge-green" : "badge-purple"}`}
                    >
                      {platformSupported(c.detectedAdapter) ? "Adapter: supported" : "Adapter: not yet supported"}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: "var(--muted)" }}>{c.evidence.join(" · ")}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <form
                      action={approveCandidateAction.bind(null, c.id)}
                      style={{ display: "inline-block", marginRight: 6 }}
                    >
                      <button className="btn btn-sm btn-primary" type="submit">
                        Approve
                      </button>
                    </form>
                    <form action={rejectCandidateAction.bind(null, c.id)} style={{ display: "inline-block" }}>
                      <button className="btn btn-sm btn-danger" type="submit">
                        Reject
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={addCandidateUrlAction} style={{ padding: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input name="url" placeholder="https://… add a URL by hand" style={{ flex: 1, minWidth: 240 }} />
          <input name="name" placeholder="Name (optional)" style={{ width: 200 }} />
          <button className="btn btn-sm" type="submit">
            Add candidate
          </button>
        </form>
      </div>

      {/* ── Source health ────────────────────────────────────────── */}
      {(degraded.length > 0 || attention.length > 0) && (
        <div className="panel">
          <div className="panel-header">
            <h2 style={{ margin: 0 }}>Source health</h2>
          </div>
          <div style={{ padding: 16, fontSize: 13 }}>
            {degraded.length > 0 && (
              <>
                <p>
                  <strong>{degraded.length} degraded.</strong> The platform declined automated access. That is
                  its access control working, not a defect — we do not attempt to bypass it, and other sources
                  are expected to cover those events.
                </p>
                <ul>
                  {degraded.map((r) => (
                    <li key={r.source.id}>
                      <strong>{r.source.name}</strong> — {r.source.healthReason ?? "no reason recorded"}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {attention.length > 0 && (
              <>
                <p>
                  <strong>{attention.length} need attention.</strong>
                </p>
                <ul>
                  {attention.map((r) => (
                    <li key={r.source.id}>
                      <strong>{r.source.name}</strong> — {r.source.healthReason ?? "no reason recorded"}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Active sources ───────────────────────────────────────── */}
      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Sources</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Adapter</th>
              <th>Entity</th>
              <th>Adapter status</th>
              <th>Trust / Crawl</th>
              <th>Last crawl</th>
              <th>Last event</th>
              <th>Health</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sourceRows.map(({ source: s, entityName, entityType }) => {
              const support = adapterSupport({
                adapterType: s.adapterType,
                active: s.active,
                healthStatus: s.healthStatus,
                consecutiveFailures: s.consecutiveFailures,
              });
              return (
              <tr key={s.id}>
                <td>
                  <strong>{s.name}</strong>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {s.url ?? (s.instagramHandle ? `@${s.instagramHandle}` : "—")}
                  </div>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {s.adapterType ?? "—"}
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.sourceType.replace(/_/g, " ")}</div>
                </td>
                <td style={{ fontSize: 12 }}>
                  {entityName ?? <span style={{ color: "var(--muted)" }}>unlinked</span>}
                  {entityType && <div style={{ fontSize: 11, color: "var(--muted)" }}>{entityType}</div>}
                </td>
                <td>
                  <span className={`badge ${SUPPORT_BADGE[support.status] ?? "badge-muted"}`}>
                    {SUPPORT_LABEL[support.status] ?? support.status}
                  </span>
                  <div style={{ fontSize: 11, color: "var(--muted)", maxWidth: 260 }}>{support.detail}</div>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {s.trustScore} / {s.crawlPriority}
                </td>
                <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{ago(s.lastCheckedAt)}</td>
                <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{ago(s.lastEventFoundAt)}</td>
                <td>
                  <span className={`badge ${HEALTH_BADGE[s.healthStatus] ?? "badge-muted"}`}>
                    {s.healthStatus}
                  </span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <form action={runSourceNowAction.bind(null, s.id)} style={{ display: "inline-block", marginRight: 6 }}>
                    <button className="btn btn-sm" type="submit" title="Mark due so the next crawl picks it up">
                      Run now
                    </button>
                  </form>
                  <form action={toggleSourceActiveAction.bind(null, s.id, !s.active)} style={{ display: "inline-block" }}>
                    <button className={`btn btn-sm ${s.active ? "" : "btn-danger"}`} type="submit">
                      {s.active ? "Active" : "Inactive"}
                    </button>
                  </form>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Entities ─────────────────────────────────────────────── */}
      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <h2 style={{ margin: 0 }}>Organizations ({organizations.length})</h2>
          </div>
          <EntityTable rows={organizations} emptyLabel="No organizations discovered yet." />
        </div>
        <div className="panel">
          <div className="panel-header">
            <h2 style={{ margin: 0 }}>Venues ({venues.length})</h2>
          </div>
          <EntityTable rows={venues} emptyLabel="No venues discovered yet." />
        </div>
      </div>

      {/* ── Add source / add university ──────────────────────────── */}
      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Add source</h2>
        </div>
        <form action={addSourceAction} style={{ padding: 16 }}>
          <div className="grid-2">
            <div>
              <label>Name</label>
              <input name="name" required placeholder="e.g. The Break Boca" />
              <label>URL</label>
              <input name="url" placeholder="https://..." />
              <label>Instagram handle (no @)</label>
              <input name="instagramHandle" placeholder="thebreakboca" />
            </div>
            <div>
              <label>Adapter (how we read it)</label>
              <select name="adapterType" defaultValue="generic_web">
                {ADAPTER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <label>Source type (what it is)</label>
              <select name="sourceType" defaultValue="generic_webpage">
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <label>Category</label>
              <select name="category" defaultValue="nearby">
                {SOURCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <label>Trust score (1-10)</label>
              <input name="trustScore" type="number" min={1} max={10} defaultValue={5} />
              <label>Crawl interval (minutes)</label>
              <input name="crawlIntervalMinutes" type="number" min={0} defaultValue={360} />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" type="submit">
              Add source
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function EntityTable({
  rows,
  emptyLabel,
}: {
  rows: { entity: { id: string; name: string; website: string | null }; sourceCount: number }[];
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>{emptyLabel}</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Sources</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ entity, sourceCount }) => (
          <tr key={entity.id}>
            <td>
              <strong>{entity.name}</strong>
              {entity.website && (
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{entity.website}</div>
              )}
            </td>
            <td>
              {sourceCount === 0 ? (
                // Known but unreachable: its events can only ever arrive
                // second-hand, which is what the coverage metric counts.
                <span className="badge badge-amber">no feed</span>
              ) : (
                sourceCount
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
