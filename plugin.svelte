<div class="plugin__mobile-header">AAZ Fleet</div>

<section class="plugin__content fleet-pane">
  <div class="plugin__title plugin__title--chevron-back" on:click={() => bcast.emit('rqstOpen', 'menu')}>
    AAZ Fleet
  </div>

  <div class="toolbar">
    <button class="action" on:click={refreshFleet} disabled={refreshing}>Refresh</button>
    <button class="action" on:click={fitAll} disabled={!hasPositions}>Fit all</button>
  </div>

  <div class="add-aircraft">
    <input
      aria-label="Aircraft registration"
      placeholder="GABC"
      bind:value={newRegistration}
      on:keydown={handleRegistrationKeydown}
      on:keyup={stopRegistrationKeyboardEvent}
      on:keypress={stopRegistrationKeyboardEvent}
    />
    <button class="add-button" on:click={addRegistration}>Add</button>
  </div>

  {#if registrations.length === 0}
    <div class="empty-state">
      Add an aircraft registration above (example: GABI). Positions come from adsb.lol.
    </div>
  {/if}

  <div class="fleet-list">
    {#each registrations as registration}
      {@const aircraft = aircraftByReg[registration]}
      <article
        class:selected={selectedRegistration === registration}
        class="aircraft-card"
        on:click={() => selectAircraft(registration)}
      >
        <div class="card-top">
          <div>
            <div class="registration">{registration}</div>
            <div class="callsign">{aircraft?.flight || aircraft?.typeCode || 'Waiting for ADS-B'}</div>
          </div>
          <span class:live={aircraft?.status === 'live'} class:stale={aircraft?.status === 'stale'} class:loading={aircraft?.status === 'loading'} class:errorDot={aircraft?.status === 'error'} class="status-dot"></span>
        </div>

        {#if aircraft?.lat !== null && aircraft?.lat !== undefined}
          <div class="metrics">
            <div><span>ALT</span><strong>{formatAltitude(aircraft.altitude)}</strong></div>
            <div><span>GS</span><strong>{formatSpeed(aircraft.groundSpeed)}</strong></div>
            <div><span>TRK</span><strong>{formatTrack(aircraft.track)}</strong></div>
          </div>
          <div class="subline">Position {formatAge(aircraft.seenPositionSeconds)} ago</div>
        {:else if aircraft?.status === 'loading'}
          <div class="subline loading-line">Checking adsb.lol…</div>
        {:else if aircraft?.error}
          <div class="error">{aircraft.error}</div>
        {:else}
          <div class="subline">Waiting for ADS-B.</div>
        {/if}

        {#if aircraft?.lastCheckedAt}
          <div class="checked">Checked {formatClock(aircraft.lastCheckedAt)}</div>
        {/if}

        <div class="card-actions">
          <button on:click|stopPropagation={() => toggleFollow(registration)}>
            {selectedRegistration === registration && followSelected ? 'Following' : 'Follow'}
          </button>
          <button
            class:trail-active={aircraft?.trailVisible}
            on:click|stopPropagation={() => void toggleTrail(registration)}
            disabled={aircraft?.trailHistoryLoading}
          >
            {aircraft?.trailHistoryLoading ? 'Loading trail…' : aircraft?.trailVisible ? 'Hide trail' : 'Show trail'}
          </button>
          <button class="remove" on:click|stopPropagation={() => removeRegistration(registration)}>Remove</button>
        </div>
      </article>
    {/each}
  </div>

  <div class="footer-note">Auto refresh every 20 seconds · Trails load the current flight from adsb.lol when enabled.</div>
</section>

<script lang="ts">
  import bcast from '@windy/broadcast';
  import { map } from '@windy/map';
  import { onDestroy, onMount } from 'svelte';

  type LatLonTuple = [number, number];
  type TrailPoint = [number, number, number];

  type AdsbAircraft = {
    hex: string;
    flight?: string | null;
    r?: string | null;
    t?: string | null;
    lat?: number | null;
    lon?: number | null;
    alt_baro?: number | string | null;
    alt_geom?: number | null;
    gs?: number | null;
    track?: number | null;
    true_heading?: number | null;
    mag_heading?: number | null;
    seen?: number;
    seen_pos?: number | null;
    lastPosition?: {
      lat: number;
      lon: number;
      seen_pos: number;
    } | null;
  };

  type AdsbResponse = {
    ac?: AdsbAircraft[];
  };

  type AdsbTraceResponse = {
    timestamp?: number;
    trace?: any[][];
  };

  type TraceSample = {
    lat: number;
    lon: number;
    timestamp: number;
    ground: boolean;
  };

  type AircraftState = {
    registration: string;
    hex: string | null;
    flight: string | null;
    typeCode: string | null;
    lat: number | null;
    lon: number | null;
    altitude: number | string | null;
    groundSpeed: number | null;
    track: number | null;
    seenPositionSeconds: number | null;
    status: 'loading' | 'live' | 'stale' | 'missing' | 'error';
    error: string | null;
    lastCheckedAt: number | null;
    trail: TrailPoint[];
    trailVisible: boolean;
    trailHistoryLoaded: boolean;
    trailHistoryLoading: boolean;
  };

  const STORAGE_KEY = 'windy-aaz-fleet-registrations-v1';
  const TRAIL_STORAGE_KEY = 'windy-aaz-fleet-trails-v3';
  const TRAIL_PREFS_STORAGE_KEY = 'windy-aaz-fleet-trail-prefs-v1';
  const POLL_MS = 20_000;
  const MAX_TRAIL_POINTS = 3000;
  const MAX_TRAIL_AGE_MS = 12 * 60 * 60 * 1000;
  const MAX_LEG_GAP_MS = 45 * 60 * 1000;

  let registrations: string[] = [];
  let aircraftByReg: Record<string, AircraftState> = {};
  let markers = new Map<string, any>();
  let trailLines = new Map<string, any>();
  let trailCasings = new Map<string, any>();
  let refreshTimer: number | undefined;
  let refreshing = false;
  let newRegistration = '';
  let selectedRegistration: string | null = null;
  let followSelected = false;
  let trailPreferences: Record<string, boolean> = {};

  $: hasPositions = Object.values(aircraftByReg).some(a => a.lat !== null && a.lon !== null);

  const sleep = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));

  const stopRegistrationKeyboardEvent = (event: KeyboardEvent): void => {
    // Windy has global keyboard shortcuts (notably F for search).
    // Keep keystrokes typed in this input inside the plugin.
    event.stopPropagation();
  };

  const handleRegistrationKeydown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key === 'Enter') addRegistration();
  };

  const normalizeRegistration = (value: string): string => {
    let normalized = value.trim().toUpperCase().replace(/\s+/g, '').replace(/-/g, '');
    // Canadian registrations can be entered as GABI instead of C-GABI.
    if (/^C[FGI][A-Z0-9]{3}$/.test(normalized)) normalized = normalized.slice(1);
    return normalized;
  };

  const adsbRegistration = (value: string): string => {
    // AAZ Canadian marks are stored/displayed without the C- prefix.
    if (/^[FGI][A-Z0-9]{3}$/.test(value)) return `C-${value}`;
    return value;
  };

  const loadSavedRegistrations = (): string[] => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(String).map(normalizeRegistration).filter(Boolean);
    } catch {
      return [];
    }
  };

  const saveRegistrations = (): void => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(registrations));
  };

  const loadTrailPreferences = (): Record<string, boolean> => {
    try {
      const raw = localStorage.getItem(TRAIL_PREFS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };

  const saveTrailPreferences = (): void => {
    try {
      localStorage.setItem(TRAIL_PREFS_STORAGE_KEY, JSON.stringify(trailPreferences));
    } catch {
      // Ignore storage errors.
    }
  };

  const loadSavedTrails = (): Record<string, TrailPoint[]> => {
    try {
      const raw = localStorage.getItem(TRAIL_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      const cutoff = Date.now() - MAX_TRAIL_AGE_MS;
      return Object.fromEntries(
        Object.entries(parsed).map(([registration, points]) => [
          registration,
          Array.isArray(points)
            ? points.filter((point: any) => Array.isArray(point) && point.length === 3 && typeof point[0] === 'number' && typeof point[1] === 'number' && typeof point[2] === 'number' && point[2] >= cutoff)
            : [],
        ])
      );
    } catch {
      return {};
    }
  };

  let savedTrails: Record<string, TrailPoint[]> = {};

  const saveTrails = (): void => {
    try {
      const cutoff = Date.now() - MAX_TRAIL_AGE_MS;
      const trails = Object.fromEntries(
        Object.entries(aircraftByReg).map(([registration, state]) => [
          registration,
          state.trail.filter(point => point[2] >= cutoff).slice(-MAX_TRAIL_POINTS),
        ])
      );
      localStorage.setItem(TRAIL_STORAGE_KEY, JSON.stringify(trails));
    } catch {
      // Ignore storage errors; live tracking still works.
    }
  };

  const emptyState = (registration: string): AircraftState => ({
    registration,
    hex: null,
    flight: null,
    typeCode: null,
    lat: null,
    lon: null,
    altitude: null,
    groundSpeed: null,
    track: null,
    seenPositionSeconds: null,
    status: 'missing',
    error: null,
    lastCheckedAt: null,
    trail: savedTrails[registration] || [],
    trailVisible: trailPreferences[registration] ?? false,
    trailHistoryLoaded: false,
    trailHistoryLoading: false,
  });

  const addRegistration = (): void => {
    const registration = normalizeRegistration(newRegistration);
    if (!registration || registrations.includes(registration)) return;
    registrations = [...registrations, registration];
    aircraftByReg = { ...aircraftByReg, [registration]: emptyState(registration) };
    newRegistration = '';
    saveRegistrations();
    void refreshOne(registration);
  };

  const removeRegistration = (registration: string): void => {
    registrations = registrations.filter(r => r !== registration);
    saveRegistrations();
    removeMapFeatures(registration);
    const next = { ...aircraftByReg };
    delete next[registration];
    aircraftByReg = next;
    const nextTrailPreferences = { ...trailPreferences };
    delete nextTrailPreferences[registration];
    trailPreferences = nextTrailPreferences;
    saveTrailPreferences();
    if (selectedRegistration === registration) {
      selectedRegistration = null;
      followSelected = false;
    }
  };

  const choosePosition = (item: AdsbAircraft): { lat: number | null; lon: number | null; seen: number | null } => {
    if (typeof item.lat === 'number' && typeof item.lon === 'number') {
      return { lat: item.lat, lon: item.lon, seen: item.seen_pos ?? item.seen ?? null };
    }
    if (item.lastPosition) {
      return {
        lat: item.lastPosition.lat,
        lon: item.lastPosition.lon,
        seen: item.lastPosition.seen_pos,
      };
    }
    return { lat: null, lon: null, seen: item.seen ?? null };
  };

  const updateTrail = (previous: TrailPoint[], item: AdsbAircraft, lat: number | null, lon: number | null): TrailPoint[] => {
    const now = Date.now();
    const cutoff = now - MAX_TRAIL_AGE_MS;
    let next = previous.filter(point => point[2] >= cutoff);

    // Seed a fresh trail with adsb.lol's last known position when available.
    if (next.length === 0 && item.lastPosition && lat !== null && lon !== null) {
      const previousAgeSeconds = Number(item.lastPosition.seen_pos || 0);
      const previousPoint: TrailPoint = [item.lastPosition.lat, item.lastPosition.lon, now - previousAgeSeconds * 1000];
      if (Math.abs(previousPoint[0] - lat) > 0.00001 || Math.abs(previousPoint[1] - lon) > 0.00001) {
        next.push(previousPoint);
      }
    }

    if (lat === null || lon === null) return next.slice(-MAX_TRAIL_POINTS);
    const last = next[next.length - 1];
    if (last && Math.abs(last[0] - lat) < 0.00001 && Math.abs(last[1] - lon) < 0.00001) return next.slice(-MAX_TRAIL_POINTS);
    return [...next, [lat, lon, now] as TrailPoint].slice(-MAX_TRAIL_POINTS);
  };

  async function fetchJsonViaRelay<T>(target: string, timeoutMs = 11_000): Promise<T> {
    const relayUrls = [
      `https://proxy.cors.dev/?url=${encodeURIComponent(target)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
    ];
    let lastError: Error | null = null;

    // adsb.lol does not expose browser CORS headers. Use cors.dev first and
    // automatically fall back to AllOrigins if the shared relay/upstream is rate-limited.
    for (let index = 0; index < relayUrls.length; index += 1) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(relayUrls[index], {
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
        });

        if (response.ok) return (await response.json()) as T;

        const relayError = response.headers.get('X-Cors-Error');
        lastError = new Error(relayError || `Request failed (${response.status}).`);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          lastError = new Error('ADS-B lookup timed out.');
        } else {
          lastError = error instanceof Error ? error : new Error('Unable to load ADS-B data.');
        }
      } finally {
        window.clearTimeout(timeout);
      }

      if (index < relayUrls.length - 1) await sleep(500);
    }

    throw lastError || new Error('Unable to load ADS-B data.');
  }

  const traceSamples = (payload: AdsbTraceResponse): TraceSample[] => {
    if (!payload.timestamp || !Array.isArray(payload.trace)) return [];
    const base = Number(payload.timestamp) * 1000;
    return payload.trace
      .map((row: any[]) => {
        if (!Array.isArray(row) || row.length < 4) return null;
        const offset = Number(row[0]);
        const lat = Number(row[1]);
        const lon = Number(row[2]);
        if (!Number.isFinite(offset) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return {
          lat,
          lon,
          timestamp: base + offset * 1000,
          ground: typeof row[3] === 'string' && row[3].toLowerCase() === 'ground',
        } as TraceSample;
      })
      .filter((point): point is TraceSample => point !== null)
      .sort((a, b) => a.timestamp - b.timestamp);
  };

  const currentFlightLeg = (samples: TraceSample[]): TrailPoint[] => {
    if (samples.length === 0) return [];
    const cutoff = Date.now() - MAX_TRAIL_AGE_MS;
    const points = samples.filter(point => point.timestamp >= cutoff);
    if (points.length <= 1) return points.map(point => [point.lat, point.lon, point.timestamp]);

    // Anchor on the most recent airborne point. This keeps the just-finished flight
    // visible after landing instead of reducing the trail to the taxi-in segment.
    let airborneIndex = points.length - 1;
    while (airborneIndex >= 0 && points[airborneIndex].ground) airborneIndex -= 1;
    if (airborneIndex < 0) return points.slice(-80).map(point => [point.lat, point.lon, point.timestamp]);

    let startIndex = 0;
    for (let index = airborneIndex; index > 0; index -= 1) {
      const gap = points[index].timestamp - points[index - 1].timestamp;
      if (gap > MAX_LEG_GAP_MS) {
        startIndex = index;
        break;
      }
      if (points[index - 1].ground) {
        startIndex = index - 1;
        break;
      }
    }

    return points.slice(startIndex).map(point => [point.lat, point.lon, point.timestamp]);
  };

  const fetchFlightTrail = async (hex: string): Promise<TrailPoint[]> => {
    const normalizedHex = hex.toLowerCase();
    const target = `https://adsb.lol/data/traces/${normalizedHex.slice(-2)}/trace_full_${normalizedHex}.json`;
    const payload = await fetchJsonViaRelay<AdsbTraceResponse>(target, 14_000);
    return currentFlightLeg(traceSamples(payload));
  };

  const loadFlightTrail = async (registration: string): Promise<void> => {
    const state = aircraftByReg[registration];
    if (!state?.hex || state.trailHistoryLoading || state.trailHistoryLoaded) return;

    aircraftByReg = {
      ...aircraftByReg,
      [registration]: { ...state, trailHistoryLoading: true },
    };

    try {
      const historicalTrail = await fetchFlightTrail(state.hex);
      const latest = aircraftByReg[registration];
      if (!latest) return;
      const merged = historicalTrail.length > 1 ? historicalTrail : latest.trail;
      const updated = {
        ...latest,
        trail: merged.slice(-MAX_TRAIL_POINTS),
        trailHistoryLoaded: true,
        trailHistoryLoading: false,
      };
      aircraftByReg = { ...aircraftByReg, [registration]: updated };
      saveTrails();
      renderAircraft(updated);
    } catch {
      const latest = aircraftByReg[registration];
      if (!latest) return;
      const updated = {
        ...latest,
        trailHistoryLoaded: false,
        trailHistoryLoading: false,
      };
      aircraftByReg = { ...aircraftByReg, [registration]: updated };
      renderAircraft(updated);
    }
  };

  const fetchAdsb = async (registration: string): Promise<AircraftState> => {
    const previous = aircraftByReg[registration] || emptyState(registration);
    const apiRegistration = adsbRegistration(registration);
    const target = `https://api.adsb.lol/v2/reg/${encodeURIComponent(apiRegistration)}`;

    try {
      const payload = await fetchJsonViaRelay<AdsbResponse>(target);
      const item = payload.ac?.[0];
      const checkedAt = Date.now();

      if (!item) {
        const hasLastPosition = previous.lat !== null && previous.lon !== null;
        return {
          ...previous,
          status: hasLastPosition ? 'stale' : 'missing',
          error: hasLastPosition ? 'No new ADS-B position. Showing the last known position.' : 'No live ADS-B signal right now.',
          lastCheckedAt: checkedAt,
        };
      }

      const position = choosePosition(item);
      const age = position.seen;
      const status: AircraftState['status'] = age !== null && age <= 90 ? 'live' : 'stale';
      const heading = item.track ?? item.true_heading ?? item.mag_heading ?? previous.track;

      return {
        registration,
        hex: item.hex || null,
        flight: item.flight?.trim() || null,
        typeCode: item.t || null,
        lat: position.lat,
        lon: position.lon,
        altitude: item.alt_baro ?? item.alt_geom ?? null,
        groundSpeed: item.gs ?? null,
        track: heading ?? null,
        seenPositionSeconds: age,
        status: position.lat === null ? 'missing' : status,
        error: position.lat === null ? 'Aircraft found, but no position is available.' : null,
        lastCheckedAt: checkedAt,
        trail: updateTrail(previous.trail, item, position.lat, position.lon),
        trailVisible: previous.trailVisible,
        trailHistoryLoaded: previous.trailHistoryLoaded,
        trailHistoryLoading: previous.trailHistoryLoading,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('ADS-B lookup timed out. Tap Refresh to try again.');
      }
      throw error;
    }
  };

  const refreshOne = async (registration: string): Promise<void> => {
    const previous = aircraftByReg[registration] || emptyState(registration);
    aircraftByReg = {
      ...aircraftByReg,
      [registration]: { ...previous, status: 'loading', error: null },
    };

    try {
      const state = await fetchAdsb(registration);
      aircraftByReg = { ...aircraftByReg, [registration]: state };
      saveTrails();
      renderAircraft(state);
      if (state.trailVisible && state.hex && !state.trailHistoryLoaded && !state.trailHistoryLoading) {
        void loadFlightTrail(registration);
      }
    } catch (error) {
      const latest = aircraftByReg[registration] || previous;
      let message = error instanceof Error ? error.message : 'Unable to load ADS-B data.';
      if (/429|rate-limit/i.test(message)) {
        message = 'Live update delayed. Keeping the last known position.';
      }
      const failedState: AircraftState = {
        ...latest,
        status: 'error',
        error: message,
        lastCheckedAt: Date.now(),
      };
      aircraftByReg = { ...aircraftByReg, [registration]: failedState };
      // Keep the existing marker/trail visible even if one refresh fails.
      renderAircraft(failedState);
    }
  };

  const refreshFleet = async (): Promise<void> => {
    if (refreshing || registrations.length === 0) return;
    refreshing = true;
    try {
      // Do not burst several requests through the public CORS relay at once.
      // Sequential polling avoids the 429 errors that were stopping marker updates.
      for (const registration of registrations) {
        await refreshOne(registration);
        if (registrations.length > 1) await sleep(1200);
      }
    } finally {
      refreshing = false;
    }
  };

  const makeAircraftIcon = (state: AircraftState): any => {
    const heading = state.track ?? 0;
    const staleClass = state.status === 'live' ? '' : ' is-stale';
    const planeSvg = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 1.5c-1.25 0-2.15 1.02-2.15 2.35v7.66L5.2 15.9v3.15l8.65-2.38v6.84l-3.05 2.18v2.24L16 26.7l5.2 1.23v-2.24l-3.05-2.18v-6.84l8.65 2.38V15.9l-8.65-4.39V3.85c0-1.33-.9-2.35-2.15-2.35Z"/></svg>`;
    return L.divIcon({
      className: 'aaz-aircraft-marker',
      html: `<div class="aaz-marker-wrap${staleClass}"><div class="aaz-plane-badge"><div class="aaz-plane" style="transform:rotate(${heading}deg)">${planeSvg}</div></div><div class="aaz-label">${state.registration}</div></div>`,
      iconSize: [86, 58],
      iconAnchor: [43, 21],
    });
  };

  const renderAircraft = (state: AircraftState): void => {
    if (state.lat === null || state.lon === null) return;
    const point: LatLonTuple = [state.lat, state.lon];
    let marker = markers.get(state.registration);

    if (!marker) {
      marker = new L.Marker(point, { icon: makeAircraftIcon(state), zIndexOffset: 1000 }).addTo(map);
      marker.on('click', () => selectAircraft(state.registration, true));
      markers.set(state.registration, marker);
    } else {
      marker.setLatLng(point);
      marker.setIcon(makeAircraftIcon(state));
    }

    const trailLatLngs = state.trail.map(point => [point[0], point[1]] as LatLonTuple);
    let casing = trailCasings.get(state.registration);
    let line = trailLines.get(state.registration);
    if (state.trailVisible && trailLatLngs.length > 1) {
      if (!casing) {
        casing = new L.Polyline(trailLatLngs, {
          color: '#101214',
          weight: 6,
          opacity: 0.78,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(map);
        trailCasings.set(state.registration, casing);
      } else {
        casing.setLatLngs(trailLatLngs);
      }

      if (!line) {
        line = new L.Polyline(trailLatLngs, {
          color: '#ff6a00',
          weight: 3,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(map);
        trailLines.set(state.registration, line);
      } else {
        line.setLatLngs(trailLatLngs);
      }
    } else {
      if (casing) {
        map.removeLayer(casing);
        trailCasings.delete(state.registration);
      }
      if (line) {
        map.removeLayer(line);
        trailLines.delete(state.registration);
      }
    }

    if (selectedRegistration === state.registration && followSelected) {
      map.panTo(point);
    }
  };

  const renderAll = (): void => {
    Object.values(aircraftByReg).forEach(renderAircraft);
  };

  const removeMapFeatures = (registration: string): void => {
    const marker = markers.get(registration);
    if (marker) {
      map.removeLayer(marker);
      markers.delete(registration);
    }
    const casing = trailCasings.get(registration);
    if (casing) {
      map.removeLayer(casing);
      trailCasings.delete(registration);
    }
    const line = trailLines.get(registration);
    if (line) {
      map.removeLayer(line);
      trailLines.delete(registration);
    }
  };

  const selectAircraft = (registration: string, center = true): void => {
    selectedRegistration = registration;
    const state = aircraftByReg[registration];
    if (center && state?.lat !== null && state?.lat !== undefined && state.lon !== null) {
      map.setView([state.lat, state.lon], Math.max(map.getZoom(), 7));
    }
  };

  const toggleFollow = (registration: string): void => {
    if (selectedRegistration !== registration) {
      selectedRegistration = registration;
      followSelected = true;
    } else {
      followSelected = !followSelected;
    }
    if (followSelected) selectAircraft(registration, true);
  };

  const toggleTrail = async (registration: string): Promise<void> => {
    const state = aircraftByReg[registration];
    if (!state) return;
    const trailVisible = !state.trailVisible;
    trailPreferences = { ...trailPreferences, [registration]: trailVisible };
    saveTrailPreferences();

    const updated = { ...state, trailVisible };
    aircraftByReg = { ...aircraftByReg, [registration]: updated };
    renderAircraft(updated);

    if (trailVisible && updated.hex && !updated.trailHistoryLoaded) {
      await loadFlightTrail(registration);
    }
  };

  const fitAll = (): void => {
    const points = Object.values(aircraftByReg)
      .filter(a => a.lat !== null && a.lon !== null)
      .map(a => [a.lat as number, a.lon as number] as LatLonTuple);
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 7);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 8 });
  };

  const formatAltitude = (altitude: number | string | null): string => {
    if (altitude === null) return '—';
    if (typeof altitude === 'string') return altitude.toUpperCase();
    return `${Math.round(altitude / 100) * 100} ft`;
  };

  const formatSpeed = (speed: number | null): string => speed === null ? '—' : `${Math.round(speed)} kt`;
  const formatTrack = (track: number | null): string => track === null ? '—' : `${Math.round(track).toString().padStart(3, '0')}°`;
  const formatClock = (timestamp: number): string => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const formatAge = (seconds: number | null): string => {
    if (seconds === null) return 'unknown';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    return `${Math.round(seconds / 60)}m`;
  };

  export const onopen = (): void => {
    void refreshFleet();
  };

  onMount(() => {
    savedTrails = loadSavedTrails();
    trailPreferences = loadTrailPreferences();
    registrations = loadSavedRegistrations();
    aircraftByReg = Object.fromEntries(registrations.map(reg => [reg, emptyState(reg)]));
    void refreshFleet();
    refreshTimer = window.setInterval(() => void refreshFleet(), POLL_MS);
  });

  onDestroy(() => {
    if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
    markers.forEach(marker => map.removeLayer(marker));
    trailCasings.forEach(line => map.removeLayer(line));
    trailLines.forEach(line => map.removeLayer(line));
    markers.clear();
    trailCasings.clear();
    trailLines.clear();
  });
</script>

<style lang="less">
  .fleet-pane {
    padding: 0 12px 14px;
    color: #f5f7f8;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 10px 0;
  }

  button { cursor: pointer; }

  .action,
  .add-button,
  .card-actions button {
    border: 0;
    border-radius: 7px;
    padding: 7px 10px;
    font-weight: 700;
  }

  .action,
  .card-actions button {
    background: #eceff1;
    color: #1b1d1f;
  }

  .action:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .add-aircraft {
    display: flex;
    gap: 7px;
    margin-bottom: 12px;
  }

  .add-aircraft input {
    flex: 1;
    min-width: 0;
    border: 1px solid #686d72;
    border-radius: 7px;
    padding: 8px 10px;
    text-transform: uppercase;
    background: #ffffff;
    color: #16191b !important;
    caret-color: #16191b;
    font-weight: 600;
  }

  .add-aircraft input::placeholder { color: #70767b; opacity: 1; }

  .add-button {
    background: #f36f21;
    color: #ffffff;
  }

  .empty-state {
    padding: 18px 10px;
    border: 1px dashed #6d7378;
    border-radius: 9px;
    font-size: 13px;
    line-height: 1.4;
    text-align: center;
    color: #e6e8e9;
  }

  .fleet-list {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .aircraft-card {
    border: 1px solid #5c6267;
    border-radius: 10px;
    padding: 10px;
    background: #2e3033;
    color: #f5f7f8 !important;
    cursor: pointer;
  }

  .aircraft-card.selected {
    border-color: #f36f21;
    box-shadow: 0 0 0 1px #f36f21;
  }

  .card-top {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: flex-start;
  }

  .registration {
    color: #ffffff !important;
    font-size: 17px;
    font-weight: 800;
    letter-spacing: 0.3px;
  }

  .callsign,
  .subline,
  .footer-note,
  .checked {
    color: #c6cacf !important;
    font-size: 11px;
  }

  .callsign { margin-top: 1px; }
  .subline { margin-top: 5px; }
  .checked { margin-top: 4px; font-size: 10px; color: #9ea4a9 !important; }
  .loading-line { font-style: italic; }

  .status-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #8d959b;
    margin-top: 5px;
    flex: 0 0 auto;
  }

  .status-dot.live { background: #39c45a; }
  .status-dot.stale { background: #e6a12c; }
  .status-dot.loading { background: #5da9ff; }
  .status-dot.errorDot { background: #ef5b51; }

  .metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin: 10px 0 5px;
  }

  .metrics div {
    background: #3b3e42;
    border-radius: 7px;
    padding: 7px;
  }

  .metrics span {
    display: block;
    color: #aeb4b9 !important;
    font-size: 9px;
    margin-bottom: 2px;
  }

  .metrics strong {
    color: #ffffff !important;
    font-size: 12px;
    white-space: nowrap;
  }

  .error {
    margin-top: 8px;
    font-size: 12px;
    line-height: 1.35;
    color: #ff9f96 !important;
  }

  .card-actions {
    display: flex;
    gap: 6px;
    margin-top: 9px;
  }

  .card-actions button {
    font-size: 11px;
    padding: 5px 8px;
  }

  .card-actions button.trail-active {
    background: #ff6a00;
    color: #ffffff;
  }

  .card-actions button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .card-actions .remove {
    margin-left: auto;
    background: transparent;
    color: #ff9f96 !important;
  }

  .footer-note {
    margin-top: 12px;
    text-align: center;
  }

  :global(.aaz-aircraft-marker) {
    background: transparent !important;
    border: 0 !important;
    transition: transform 650ms linear;
  }

  :global(.aaz-marker-wrap) {
    position: relative;
    width: 86px;
    height: 58px;
    pointer-events: auto;
  }

  :global(.aaz-plane-badge) {
    position: absolute;
    left: 24px;
    top: 0;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: rgba(18, 19, 21, 0.94);
    border: 3px solid #ff6a00;
    box-shadow: 0 2px 7px rgba(0,0,0,0.62);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :global(.aaz-plane) {
    width: 29px;
    height: 29px;
    transform-origin: 50% 50%;
  }

  :global(.aaz-plane svg) {
    display: block;
    width: 29px;
    height: 29px;
    overflow: visible;
    fill: #ffffff;
    stroke: #111315;
    stroke-width: 1.6px;
    stroke-linejoin: round;
    paint-order: stroke fill;
    filter: drop-shadow(0 1px 1px rgba(0,0,0,0.75));
  }

  :global(.aaz-marker-wrap.is-stale .aaz-plane-badge) { opacity: 0.68; }

  :global(.aaz-label) {
    position: absolute;
    left: 50%;
    top: 41px;
    transform: translateX(-50%);
    background: rgba(18, 19, 21, 0.94);
    color: #ffffff;
    border: 1px solid #ff6a00;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 800;
    white-space: nowrap;
    box-shadow: 0 1px 4px rgba(0,0,0,0.45);
  }
</style>
