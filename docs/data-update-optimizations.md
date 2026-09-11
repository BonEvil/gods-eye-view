# Regional feeds and incremental updates

The browser requests the visible ground rectangle plus a 25% buffer (minimum
half a degree), snapped outwards to half-degree cells. A selected aircraft or
vessel's last position expands the retained region. Requests also carry its
identity so server filtering reserves it independently of count limits.
Camera-settle refreshes wait at least 500 ms and respect the layer spacing
(12 seconds for aircraft, 60 seconds for AIS). Normal manager polling remains.
Movement cancels pending settle timers; disabling/destroying removes listeners.
There are no map-resolution, tile-detail, antialiasing, or visual-style changes.

## Server behavior

- OpenSky receives geographic bounds and keeps up to 32 region-specific cached
  snapshots. Misses are serialized and share the existing adaptive credit
  governor across clients. A new uncached region during the governor's waiting
  period receives a retry response rather than another upstream request.
  At the dateline, one latitude-bounded upstream request avoids doubling credit
  spend; the returned snapshot is filtered across both longitude segments.
- Military aircraft retain the existing shared global upstream snapshot, with
  geographic filtering before browser serialization.
- AIS filters by geography before applying the row cap, reserving the selected
  vessel. Browser client IDs maintain three-minute coverage leases. The single
  compressed upstream subscription covers the union of active clients' regions,
  split at the dateline. Replacement subscriptions are spaced by at least
  1.1 seconds and coalesced. With no leases the socket stops on the watchdog tick.
  Explicit `AISSTREAM_BOUNDING_BOXES` continues to override upstream coverage.
  Legacy requests without bounds retain worldwide behavior; a bounded client
  registry falls back to worldwide coverage temporarily if full.
- Out-of-region aircraft are removed on the next accepted regional snapshot
  without consuming the missing-contact grace reserved for local/tracked targets.
  An empty AIS region also discards distant records while preserving selected
  and local stale records. Fewer objects means fewer recurring movement and
  visibility calculations.

## CCTV and earthquakes

CCTV still-frame acquisition is shared server-side by registered source URL,
including concurrent preview/projection/thumbnail requests with different
browser cache-busting parameters. Successful frames remain fresh for ten seconds;
failed refreshes may serve a marked last-good frame up to sixty seconds old.
Each cache is bounded to 128 entries/32 MiB and eight concurrent acquisitions;
individual images have an 8 MiB read cap. Street View fallback frames use a
separate cache whose URL keys include pose and credentials; those keys are never
logged. Live video keeps its existing path. Browser image decodes are not shared.

Earthquakes reconcile by stable event identity and material field values.
Identical polls retain entity and geometry objects and skip overlay publication.
Changed/deleted events update individually; metadata-only changes retain geometry.
Successful-fetch timestamps and error recovery still advance on unchanged feeds.
Destroyed-layer responses cannot populate a replacement data source.

## Verification and limits

- Full ordinary suite: 2,729 passed, no failures, one Windows-only test skipped
  on macOS; the additional empty-region regression is run separately.
- All 14 calibrated allocation tests passed under Node 24.14.0.
- Production build passed (existing large-chunk advisory remains).
- Chrome smoke check: keyless Esri map, navigation, and 33 live USGS earthquakes
  rendered without console errors. Authenticated flight/AIS operation was not
  exercised in this isolated checkout.
- Deterministic earthquake probe: unchanged 58-event snapshot retained 58/58
  entities and published overlays once, versus 0/58 and twice in the audit.
- Three simultaneous CCTV consumers produced one upstream acquisition.
- Synthetic uniform vessel fixture: 12,000 rows/931,011 JSON bytes became
  33 rows/2,620 bytes for the chosen region. This is not a live savings estimate.

Provider limits, gaps, and freshness remain authoritative. Newly subscribed AIS
regions must accumulate reports; there is no historical backfill guarantee.
Sky-only views without a reliable ground footprint retain global behavior.
Selected targets retain existing genuine-source-outage eviction rules; this is
not the deferred persistent watchlist. There is no database or continuous
worldwide archive in this change.
