# Incident explorer frontend

Serve this directory from the local app's same origin. `index.html` loads `app.js`, `state.js`, and `styles.css`; requests use the settled `/api/incidents`, `/api/incidents/:id`, and `/api/export.csv` endpoints. No dataset or server is embedded in the frontend.

Search is submitted with Search or Enter. Facet, date, sorting, and page-size changes apply immediately and return to page one. Dates and displayed timestamps use UTC. The overview and daily counts describe the full matching result. While updating, the previous completed rows and summaries remain explicitly marked, and page controls are disabled. CSV exports the current applied selections and sort, across all pages; tags follow the API's JSON-array CSV representation.

Copy the browser address to share the applied query, including its page. Fresh tabs and reloads restore the address; Back and Forward restore all controls even when search has focus. Draft text and details are excluded. Invalid values fall back safely before requests; the first duplicate scalar wins, unsupported facets are removed and inverted date ranges are discarded. Navigation supersedes pending results, details and downloads.

Named views persist the applied search, facets, dates, sorting, and page size in browser localStorage. Opening a view applies its selections together and returns to page one. Storage failures are visible and exploration remains available.

The native details dialog supports keyboard dismissal, exposes every incident field as text, and restores focus to the incident on return. Results, detail sessions, and exports have separate ownership tokens. Each completion, error, and cleanup is gated; changed selections invalidate details and export downloads. Cancellation helps save work but tokens provide correctness. Download object URLs are released.

Run the repository's exact verification command from the checkout:

```sh
npm test
```

Discoverable tests under `tests/frontend/` exercise the actual DOM-free state module with direct events. These establish component behavior, including overlapping intents and retries; they do not establish real HTTP or browser integration. Real HTTP and sandbox-enabled Chromium integration tests compare results with the canonical independent oracle and exercise the existing backend. Owned servers and browsers close in cleanup paths.

Component review: `state.js` separates the requested intent from the last displayed snapshot and publishes rows and whole-result summaries atomically. Pending or stale queries lock pagination, and synchronous page transitions are clamped before dispatch. The UI retains the native modal and return target while detail ownership changes; it renders dataset values through text nodes. Independent operation tokens gate success, failure, and cleanup, and export gates download side effects after reading the response. This review establishes frontend structure and state behavior only.
