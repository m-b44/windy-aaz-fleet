const USER_AGENT = 'AAZ-Fleet/0.1.10 (+https://www.aazaviation.com/)';
const MAX_REGISTRATIONS = 12;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

const fetchJson = async (url, timeoutMs = 5000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* handled below */ }
    if (!response.ok) {
      const detail = data?.error || data?.message || text || `HTTP ${response.status}`;
      throw new Error(detail);
    }
    if (data === null) throw new Error('Upstream returned invalid JSON.');
    return data;
  } finally {
    clearTimeout(timer);
  }
};

const cleanRegistrations = raw => {
  const items = String(raw || '')
    .split(',')
    .map(value => value.trim().toUpperCase())
    .filter(Boolean)
    .filter(value => /^[A-Z0-9-]{2,12}$/.test(value));
  return [...new Set(items)].slice(0, MAX_REGISTRATIONS);
};

const normalizeAircraftList = payload => {
  if (Array.isArray(payload?.ac)) return payload.ac;
  if (Array.isArray(payload?.aircraft)) return payload.aircraft;
  return [];
};

const registrationKey = value => String(value || '').toUpperCase().replace(/-/g, '');

const fetchAdsbLolOne = async registration => {
  const payload = await fetchJson(`https://api.adsb.lol/v2/reg/${encodeURIComponent(registration)}`, 5000);
  return normalizeAircraftList(payload);
};

const fetchAdsbFiOne = async registration => {
  const payload = await fetchJson(`https://opendata.adsb.fi/api/v2/registration/${encodeURIComponent(registration)}`, 5000);
  return normalizeAircraftList(payload);
};

const addMatchingAircraft = (map, registration, items) => {
  const wanted = registrationKey(registration);
  for (const aircraft of items) {
    const key = registrationKey(aircraft?.r);
    if (key && key === wanted) map.set(key, aircraft);
  }
  return map.has(wanted);
};

const fetchLiveFleet = async registrations => {
  const warnings = [];
  const byRegistration = new Map();
  let adsbFiCalls = 0;

  // adsb.lol documents one registration per /v2/reg/{registration} request.
  // The Windy plugin still makes only one request to this relay; the relay
  // performs the provider lookups server-side and returns one combined payload.
  for (const registration of registrations) {
    let found = false;

    try {
      const items = await fetchAdsbLolOne(registration);
      found = addMatchingAircraft(byRegistration, registration, items);
    } catch (error) {
      warnings.push(`adsb.lol ${registration}: ${error instanceof Error ? error.message : 'failed'}`);
    }

    if (!found) {
      // adsb.fi's public API is limited to 1 request/second. Space fallback calls.
      if (adsbFiCalls > 0) await sleep(1050);
      adsbFiCalls += 1;
      try {
        const items = await fetchAdsbFiOne(registration);
        addMatchingAircraft(byRegistration, registration, items);
      } catch (error) {
        warnings.push(`adsb.fi ${registration}: ${error instanceof Error ? error.message : 'failed'}`);
      }
    }
  }

  return {
    ac: [...byRegistration.values()],
    source: 'adsb.lol with adsb.fi fallback',
    warnings,
  };
};

const fetchTrace = async hex => {
  const normalized = String(hex || '').trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(normalized)) throw new Error('Invalid ICAO hex.');
  const url = `https://adsb.lol/data/traces/${normalized.slice(-2)}/trace_full_${normalized}.json`;
  return fetchJson(url, 9000);
};

export default async function handler(req, res) {
  for (const [key, value] of Object.entries(responseHeaders)) res.setHeader(key, value);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only.' });

  try {
    const url = new URL(req.url, 'https://relay.local');
    const trace = url.searchParams.get('trace');
    if (trace) {
      const payload = await fetchTrace(trace);
      res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=20');
      return res.status(200).json(payload);
    }

    const registrations = cleanRegistrations(url.searchParams.get('regs'));
    if (registrations.length === 0) return res.status(400).json({ error: 'No valid registrations supplied.' });

    const payload = await fetchLiveFleet(registrations);
    res.setHeader('Cache-Control', 'public, s-maxage=4, stale-while-revalidate=8');
    return res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Relay request failed.';
    return res.status(502).json({ error: message });
  }
}
