AAZ Fleet v0.1.4

Root-file layout only. Upload/replace these files at the root of the GitHub repository.

Changes in 0.1.4:
- Per-aircraft Show trail / Hide trail control.
- Trail is OFF by default for each aircraft and the preference is remembered.
- When enabled, the plugin loads adsb.lol's current full trace and trims it to the most recent flight leg (from takeoff / most recent leg).
- Live positions continue extending the trail every 15 seconds.
- Thicker high-contrast orange trail with dark casing.
- Proper north-facing SVG aircraft icon rotated by ADS-B track.
- No C- prefix required when entering Canadian registrations (example: GOCF, GABI).

No src folder and no dist folder should be uploaded manually. GitHub Actions creates dist during publishing.
