AAZ Fleet v0.1.12

Root-only Windy plugin. No Vercel/Cloudflare/account required.
Live data: exact registration lookup, not aircraft type. Any registration can be added.
Primary live source: adsb.lol. Fallback live source: airplanes.live.
Browser CORS: keyless cors.dev with keyless AllOrigins fallback.
Requests are serialized one aircraft at a time to avoid simultaneous lookup failures.
Trails: adsb.lol current trace, cut to the current flight leg and connected to the live aircraft position.

Upload these files to the root of the existing GitHub repository and run the existing publish-plugin action.
