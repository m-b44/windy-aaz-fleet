AAZ Fleet v0.1.10

ROOT FILE METHOD
- Upload/replace all files in this folder at the ROOT of the GitHub repo.
- No src folder is used.

WHAT CHANGED
- Removed public CORS relays (they were causing the timeouts).
- Added a tiny personal Vercel relay: api-adsb.js + vercel.json.
- One live request retrieves the whole tracked fleet.
- adsb.lol is primary; adsb.fi is a fallback for missing live positions.
- Trail detection now starts from the latest takeoff/new-leg boundary.
- Trail is always extended to the latest live aircraft position.
- Aircraft marker is no longer recreated on updates, fixing the Windy zoom/jump bug.
- Registration can still be entered without C- (GOCF, GABI, FFJW, etc.).

ONE-TIME VERCEL SETUP
1. Import the same GitHub repository into Vercel.
2. Deploy it. vercel.json exposes /api/adsb from the root api-adsb.js file.
3. Copy the deployment URL, e.g. https://windy-aaz-fleet.vercel.app
4. Open AAZ Fleet in Windy and paste that URL into Data relay, then Save.

No ADS-B API key is required.
