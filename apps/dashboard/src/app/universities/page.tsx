import { COVERAGE_CATEGORIES } from "@college-events/ingestion";
import { getCurrentSchool, listUniversities } from "@/lib/current-school";
import { addUniversityAction, selectUniversityAction } from "@/lib/discovery-actions";

export const dynamic = "force-dynamic";

/**
 * Onboarding a university.
 *
 * The whole architecture is making one claim, and this page is where it
 * gets tested: adding a school is filling in this form. No adapter, no
 * migration, no scraper. What follows — discovery, fingerprinting,
 * approving candidates, the first crawl — runs on the same code every
 * other university uses.
 */
export default async function UniversitiesPage() {
  const universities = await listUniversities();
  const current = await getCurrentSchool();
  const expectedCategories = COVERAGE_CATEGORIES.filter((c) => c.expected);

  return (
    <>
      <h1>Universities</h1>
      <p className="subtitle">
        {universities.length} configured. Everything school-specific lives in these records and in each
        source&rsquo;s config — adapters never name a university.
      </p>

      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Configured</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Domain</th>
              <th>Location</th>
              <th>Timezone</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {universities.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.shortName}</strong>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{u.name}</div>
                </td>
                <td style={{ fontSize: 12 }}>
                  {u.primaryDomain ?? (
                    // Without a domain, site: queries cannot be built and
                    // first-party discovery has nothing to scope to.
                    <span className="badge badge-amber">no domain — discovery limited</span>
                  )}
                </td>
                <td style={{ fontSize: 12 }}>
                  {u.city}, {u.state}
                </td>
                <td style={{ fontSize: 12 }}>{u.timezone}</td>
                <td>
                  {u.id === current.id ? (
                    <span className="badge badge-blue">viewing</span>
                  ) : (
                    <form action={selectUniversityAction}>
                      <input type="hidden" name="schoolId" value={u.id} />
                      <button className="btn btn-sm" type="submit">
                        Switch to
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Add university</h2>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            Then: Discover sources → review candidates → first crawl.
          </span>
        </div>
        <form action={addUniversityAction} style={{ padding: 16 }}>
          <div className="grid-2">
            <div>
              <label>Name</label>
              <input name="name" required placeholder="University of Central Florida" />
              <label>Short name</label>
              <input name="shortName" required placeholder="UCF" />
              <label>Primary domain</label>
              <input name="primaryDomain" placeholder="ucf.edu" />
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: -6, marginBottom: 10 }}>
                Anchors <code>site:</code> discovery queries and decides whether a found URL is
                first-party. A full URL is fine — it gets trimmed to the domain.
              </div>
              <label>Instagram account</label>
              <input name="instagramAccount" placeholder="ucf.events" />
            </div>
            <div>
              <label>City</label>
              <input name="city" required placeholder="Orlando" />
              <label>State</label>
              <input name="state" required placeholder="Florida" />
              <label>Timezone</label>
              <input name="timezone" defaultValue="America/New_York" />
              <label>Latitude</label>
              <input name="latitude" type="number" step="any" placeholder="28.6024" />
              <label>Longitude</label>
              <input name="longitude" type="number" step="any" placeholder="-81.2001" />
              <label>Nightlife radius (miles)</label>
              <input name="nightlifeRadiusMiles" type="number" min={1} defaultValue={25} />
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: -6 }}>
                Separate from the campus radius: a commuter school draws nightlife from a wider ring
                than it draws campus events.
              </div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" type="submit">
              Create university
            </button>
          </div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>What discovery will look for</h2>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            The same taxonomy for every university — it is also the denominator in the coverage report.
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Looks for</th>
              <th>Scope</th>
            </tr>
          </thead>
          <tbody>
            {expectedCategories.map((c) => (
              <tr key={c.key}>
                <td>
                  <strong>{c.label}</strong>
                </td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{c.terms.join(", ")}</td>
                <td style={{ fontSize: 12 }}>
                  {c.firstParty ? "university domain" : "around the city"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
