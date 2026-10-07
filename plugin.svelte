<div class="plugin__mobile-header">AAZ Fleet</div>

<section class="plugin__content fleet-pane">
  <div class="plugin__title plugin__title--chevron-back" on:click={() => bcast.emit('rqstOpen', 'menu')}>
    AAZ Fleet
  </div>

  <div class="toolbar">
    <button class="action" on:click={refreshFleet} disabled={refreshing}>Refresh</button>
    <button class="action" on:click={fitAll} disabled={!hasPositions}>Fit all</button>
    <label class="trail-toggle">
      <input type="checkbox" bind:checked={showTrails} on:change={renderAll} />
      Trails
    </label>
  </div>

  <div class="add-aircraft">
    <input
      aria-label="Aircraft registration"
      placeholder="GABC"
      bind:value={newRegistration}
      on:keydown={(event) => event.key === 'Enter' && addRegistration()}
    />
    <button class="add-button" on:click={addRegistration}>Add</button>
  </div>

  {#if registrations.length === 0}
    <div class="empty-state">
      Add a King Air registration above (example: GABI). Positions come from adsb.lol.
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
          <span class:live={aircraft?.status === 'live'} class:stale={aircraft?.status === 'stale'} class="status-dot"></span>
        </div>

        {#if aircraft?.lat !== null && aircraft?.lat !== undefined}
          <div class="metrics">
            <div><span>ALT</span><strong>{formatAltitude(aircraft.altitude)}</strong></div>
            <div><span>GS</span><strong>{formatSpeed(aircraft.groundSpeed)}</strong></div>
            <div><span>TRK</span><strong>{formatTrack(aircraft.track)}</strong></div>
          </div>
          <div class="subline">Position {formatAge(aircraft.seenPositionSeconds)} ago</div>
        {:else if aircraft?.error}
          <div class="error">{aircraft.error}</div>
        {:else}
          <div class="subline">Looking for aircraft…</div>
        {/if}

        <div class="card-actions">
          <button on:click|stopPropagation={() => toggleFollow(registration)}>
            {selectedRegistration === registration && followSelected ? 'Following' : 'Follow'}
          </button>
          <button class="remove" on:click|stopPropagation={() => removeRegistration(registration)}>Remove</button>
        </div>
      </article>
    {/each}
  </div>

  <div class="footer-note">Auto refresh every 15 seconds · ADS-B data: adsb.lol</div>
</section>

<script lang="ts">
  import bcast from '@windy/broadcast';
  import { map } from '@windy/map';
  import { onDestroy, onMount } from 'svelte';

  type LatLonTuple = [number, number];

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
    status: 'live' | 'stale' | 'missing';
    error: string | null;
    trail: LatLonTuple[];
  };

  const STORAGE_KEY = 'windy-aaz-fleet-registrations-v1';
  const POLL_MS = 15_000;
  const MAX_TRAIL_POINTS = 120;

  let registrations: string[] = [];
  let aircraftByReg: Record<string, AircraftState> = {};
  let markers = new Map<string, any>();
  let trailLines = new Map<string, any>();
  let refreshTimer: number | undefined;
  let refreshing = false;
  let newRegistration = '';
  let selectedRegistration: string | null = null;
  let followSelected = false;
  let showTrails = true;

  $: hasPositions = Object.values(aircraftByReg).some(a => a.lat !== null && a.lon !== null);

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
    trail: [],
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

  const updateTrail = (previous: LatLonTuple[], lat: number | null, lon: number | null): LatLonTuple[] => {
    if (lat === null || lon === null) return previous;
    const nextPoint: LatLonTuple = [lat, lon];
    const last = previous[previous.length - 1];
    if (last && Math.abs(last[0] - lat) < 0.00001 && Math.abs(last[1] - lon) < 0.00001) return previous;
    return [...previous, nextPoint].slice(-MAX_TRAIL_POINTS);
  };

  const fetchAdsb = async (registration: string): Promise<AircraftState> => {
    const previous = aircraftByReg[registration] || emptyState(registration);
    const apiRegistration = adsbRegistration(registration);
    const target = `https://api.adsb.lol/v2/reg/${encodeURIComponent(apiRegistration)}`;

    // adsb.lol intentionally does not send browser CORS headers. Windy plugins run
    // in the browser, so use a read-only CORS relay for this public GET request.
    const proxyUrls = [
      `https://proxy.cors.dev/${target}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
    ];

    let response: Response | null = null;
    let lastError: unknown = null;
    for (const url of proxyUrls) {
      try {
        const candidate = await fetch(url, { credentials: 'omit', cache: 'no-store' });
        if (candidate.ok) {
          response = candidate;
          break;
        }
        lastError = new Error(`ADS-B relay returned ${candidate.status}`);
      } catch (error) {
        lastError = error;
      }
    }

    if (!response) {
      throw lastError instanceof Error ? lastError : new Error('Unable to reach ADS-B service.');
    }

    const payload = (await response.json()) as AdsbResponse;
    const item = payload.ac?.[0];
    if (!item) {
      return { ...previous, status: 'missing', error: 'Not currently visible on ADS-B.' };
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
      status,
      error: position.lat === null ? 'Aircraft found, but no position is available.' : null,
      trail: updateTrail(previous.trail, position.lat, position.lon),
    };
  };

  const refreshOne = async (registration: string): Promise<void> => {
    try {
      const state = await fetchAdsb(registration);
      aircraftByReg = { ...aircraftByReg, [registration]: state };
      renderAircraft(state);
    } catch (error) {
      const previous = aircraftByReg[registration] || emptyState(registration);
      const message = error instanceof Error ? error.message : 'Unable to load ADS-B data.';
      aircraftByReg = {
        ...aircraftByReg,
        [registration]: { ...previous, status: 'missing', error: message },
      };
    }
  };

  const refreshFleet = async (): Promise<void> => {
    if (refreshing || registrations.length === 0) return;
    refreshing = true;
    try {
      await Promise.all(registrations.map(registration => refreshOne(registration)));
    } finally {
      refreshing = false;
    }
  };

  const makeAircraftIcon = (state: AircraftState): any => {
    const heading = state.track ?? 0;
    const staleClass = state.status === 'live' ? '' : ' is-stale';
    return L.divIcon({
      className: 'aaz-aircraft-marker',
      html: `<div class="aaz-marker-wrap${staleClass}"><div class="aaz-plane" style="transform:rotate(${heading}deg)">✈</div><div class="aaz-label">${state.registration}</div></div>`,
      iconSize: [70, 42],
      iconAnchor: [35, 20],
    });
  };

  const renderAircraft = (state: AircraftState): void => {
    if (state.lat === null || state.lon === null) return;
    const point: LatLonTuple = [state.lat, state.lon];
    let marker = markers.get(state.registration);

    if (!marker) {
      marker = new L.Marker(point, { icon: makeAircraftIcon(state) }).addTo(map);
      marker.on('click', () => selectAircraft(state.registration, true));
      markers.set(state.registration, marker);
    } else {
      marker.setLatLng(point);
      marker.setIcon(makeAircraftIcon(state));
    }

    let line = trailLines.get(state.registration);
    if (showTrails && state.trail.length > 1) {
      if (!line) {
        line = new L.Polyline(state.trail, { weight: 2, opacity: 0.7 }).addTo(map);
        trailLines.set(state.registration, line);
      } else {
        line.setLatLngs(state.trail);
      }
    } else if (line) {
      map.removeLayer(line);
      trailLines.delete(state.registration);
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
  const formatAge = (seconds: number | null): string => {
    if (seconds === null) return 'unknown';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    return `${Math.round(seconds / 60)}m`;
  };

  export const onopen = (): void => {
    void refreshFleet();
  };

  onMount(() => {
    registrations = loadSavedRegistrations();
    aircraftByReg = Object.fromEntries(registrations.map(reg => [reg, emptyState(reg)]));
    void refreshFleet();
    refreshTimer = window.setInterval(() => void refreshFleet(), POLL_MS);
  });

  onDestroy(() => {
    if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
    markers.forEach(marker => map.removeLayer(marker));
    trailLines.forEach(line => map.removeLayer(line));
    markers.clear();
    trailLines.clear();
  });
</script>

<style lang="less">
  .fleet-pane {
    padding: 0 12px 14px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 10px 0;
  }

  button {
    cursor: pointer;
  }

  .action,
  .add-button,
  .card-actions button {
    border: 0;
    border-radius: 7px;
    padding: 7px 10px;
    font-weight: 600;
    background: #eceff1;
  }

  .action:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .trail-toggle {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
  }

  .add-aircraft {
    display: flex;
    gap: 7px;
    margin-bottom: 12px;
  }

  .add-aircraft input {
    flex: 1;
    min-width: 0;
    border: 1px solid #cfd5d9;
    border-radius: 7px;
    padding: 8px 10px;
    text-transform: uppercase;
  }

  .add-button {
    background: #f36f21;
    color: white;
  }

  .empty-state {
    padding: 18px 10px;
    border: 1px dashed #cfd5d9;
    border-radius: 9px;
    font-size: 13px;
    line-height: 1.4;
    text-align: center;
    opacity: 0.8;
  }

  .fleet-list {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .aircraft-card {
    border: 1px solid #dce1e4;
    border-radius: 10px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.94);
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
    font-size: 17px;
    font-weight: 800;
    letter-spacing: 0.3px;
  }

  .callsign,
  .subline,
  .footer-note {
    font-size: 11px;
    opacity: 0.65;
  }

  .status-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #9ea7ad;
    margin-top: 5px;
  }

  .status-dot.live { background: #2aa84a; }
  .status-dot.stale { background: #e19a22; }

  .metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin: 10px 0 5px;
  }

  .metrics div {
    background: #f5f6f7;
    border-radius: 7px;
    padding: 7px;
  }

  .metrics span {
    display: block;
    font-size: 9px;
    opacity: 0.6;
    margin-bottom: 2px;
  }

  .metrics strong {
    font-size: 12px;
    white-space: nowrap;
  }

  .error {
    margin-top: 9px;
    font-size: 12px;
    color: #a43d31;
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

  .card-actions .remove {
    margin-left: auto;
    background: transparent;
    color: #a43d31;
  }

  .footer-note {
    margin-top: 12px;
    text-align: center;
  }

  :global(.aaz-aircraft-marker) {
    background: transparent !important;
    border: 0 !important;
  }

  :global(.aaz-marker-wrap) {
    position: relative;
    width: 70px;
    height: 42px;
    pointer-events: auto;
  }

  :global(.aaz-plane) {
    position: absolute;
    left: 23px;
    top: 0;
    width: 24px;
    height: 24px;
    line-height: 24px;
    text-align: center;
    font-size: 22px;
    color: #111;
    transform-origin: 50% 50%;
    text-shadow: 0 0 3px white, 0 0 3px white;
  }

  :global(.aaz-marker-wrap.is-stale .aaz-plane) {
    opacity: 0.55;
  }

  :global(.aaz-label) {
    position: absolute;
    left: 50%;
    top: 24px;
    transform: translateX(-50%);
    background: rgba(20, 20, 20, 0.82);
    color: white;
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }
</style>
