AAZ Fleet v0.1.5

Root-file layout only. Upload/replace these files at the root of the GitHub repository.

Changes in 0.1.5:
- Fix: typing F (or other keys) in the registration box no longer triggers Windy keyboard shortcuts.
- Thinner aircraft trails (orange line with a smaller dark casing).
- Live ADS-B refreshes are sequential instead of simultaneous to reduce 429 errors.
- Automatic fallback to a second free CORS relay if the first relay/upstream is temporarily rate-limited.
- If an update fails or no new position is returned, the last known aircraft marker/trail stays visible.
- Short marker transition makes new ADS-B positions visibly move on the map.
- Auto refresh every 20 seconds.
- Generic wording: supports any aircraft registration, not only King Airs.
- Plane heading is refreshed from ADS-B track on every successful update.

No src folder and no dist folder should be uploaded manually. GitHub Actions creates dist during publishing.


v0.1.6: fixed Leaflet marker zoom/pan drift, added safe smooth movement, slimmer trails, and stale-state handling when ADS-B refresh fails.
