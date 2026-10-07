AAZ Fleet v0.1.8

Root-file build for easy GitHub upload.

Fixes in this release:
- Restores reliable one-aircraft-at-a-time ADS-B polling instead of the failing bulk lookup.
- Rotates across multiple CORS relays if one is unavailable.
- Removes custom marker movement animation that conflicted with Windy zooming.
- Reapplies marker heading/anchor after zoom.
- Keeps the current-flight trail attached to the aircraft's latest live position.
- Uses readsb's new-leg flag to start the trail at the current flight leg.
- Trail cache key bumped to avoid old incorrect route data.

Upload/replace the files at the ROOT of the GitHub repository, commit, then run publish-plugin.
