import type { BusRoute, Network, Pattern, Station, SubTrip, Vehicle } from './types';

const LAT0 = 12.95, LON0 = 80.17, KM_LAT = 110.57, KM_LON = 111.32 * Math.cos((13 * Math.PI) / 180);
export const project = (lat: number, lon: number): [number, number] => [(lon - LON0) * KM_LON, -(lat - LAT0) * KM_LAT];

export function dayTypeOf(epochMs: number): { day: 'weekday' | 'saturday' | 'sunday'; secOfDay: number; label: string } {
  const ist = new Date(epochMs + 5.5 * 3600 * 1000);
  const dow = ist.getUTCDay();
  const secOfDay = ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds();
  const day = dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : 'weekday';
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return { day, secOfDay, label: `${names[dow]} ${ist.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][ist.getUTCMonth()]} ${ist.getUTCFullYear()}` };
}

export const fmtClock = (sec: number) => {
  const s = ((Math.floor(sec) % 86400) + 86400) % 86400;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};
export const fmtHM = (sec: number) => fmtClock(sec).slice(0, 5);
const hhmm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 3600 + m * 60; };

interface Poly { pts: [number, number][]; cum: number[]; len: number }
function poly(pts: [number, number][]): Poly {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}
function at(p: Poly, d: number): { x: number; z: number; heading: number } {
  d = Math.max(0, Math.min(p.len, d));
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < d) i++;
  const [x0, z0] = p.pts[i - 1], [x1, z1] = p.pts[i];
  const seg = p.cum[i] - p.cum[i - 1] || 1, f = (d - p.cum[i - 1]) / seg;
  return { x: x0 + (x1 - x0) * f, z: z0 + (z1 - z0) * f, heading: Math.atan2(z1 - z0, x1 - x0) };
}

export class Sim {
  net: Network;
  stById = new Map<string, Station>();
  xy = new Map<string, [number, number]>();
  linePoly = new Map<string, Poly>();
  lineIdx = new Map<string, Map<string, number>>();
  busPoly = new Map<string, Poly>();
  busStopD = new Map<string, number[]>();
  constructor(net: Network) {
    this.net = net;
    net.stations.forEach((s) => { this.stById.set(s.id, s); this.xy.set(s.id, project(s.lat, s.lon)); });
    net.lines.forEach((l) => {
      const pts = l.stationIds.map((id) => this.xy.get(id)!);
      this.linePoly.set(l.id, poly(pts));
      this.lineIdx.set(l.id, new Map(l.stationIds.map((id, i) => [id, i])));
    });
    net.busRoutes.forEach((r) => {
      const p = poly(r.stops.map((s) => project(s.lat, s.lon)));
      this.busPoly.set(r.id, p);
      this.busStopD.set(r.id, p.cum);
    });
  }

  private subTrips(day: string): SubTrip[] {
    const sets = this.net.dayTypes[day].filter((s) => s.startsWith('sub-'));
    return sets.flatMap((s) => this.net.tripSets[s]);
  }
  private patterns(day: string): Pattern[] {
    const sets = this.net.dayTypes[day].filter((s) => s.startsWith('metro-'));
    return sets.flatMap((s) => this.net.patternSets[s]);
  }

  vehicles(day: 'weekday' | 'saturday' | 'sunday', t: number, modes: { rail: boolean; metro: boolean; bus: boolean }): Vehicle[] {
    const out: Vehicle[] = [];
    const rail = this.net.lines.find((l) => l.id === 'SUB')!;
    if (modes.rail) {
      for (const trip of this.subTrips(day)) {
        for (const tt of [t, t + 86400]) {
          const first = trip.t[0], last = trip.t[trip.t.length - 1];
          if (tt < first || tt > last) continue;
          let i = 1;
          while (i < trip.t.length - 1 && trip.t[i] < tt) i++;
          const a = trip.t[i - 1], b = trip.t[i];
          const sa = this.xy.get(rail.stationIds[trip.s[i - 1]])!, sb = this.xy.get(rail.stationIds[trip.s[i]])!;
          const f = b === a ? 1 : (tt - a) / (b - a);
          const x = sa[0] + (sb[0] - sa[0]) * f, z = sa[1] + (sb[1] - sa[1]) * f;
          const nextSt = this.stById.get(rail.stationIds[trip.s[i]])!;
          out.push({ key: `R${trip.id}`, mode: 'rail', lineId: 'SUB', color: '#c2410c', x, z,
            heading: Math.atan2(sb[1] - sa[1], sb[0] - sa[0]) || 0, title: `Train ${trip.id.replace('R', '')}`,
            subtitle: trip.label, nextStop: nextSt.name, nextEta: b - tt, note: trip.note, estimated: !trip.pub.includes(trip.s[i]), dir: trip.dir });
          break;
        }
      }
    }
    if (modes.metro) {
      for (const p of this.patterns(day)) {
        const n = p.stations.length, total = p.arr[n - 1];
        const line = this.net.lines.find((l) => l.id === p.line)!;
        for (const d of p.departures) {
          if (t < d || t > d + total) continue;
          const rel = t - d;
          let i = 1;
          while (i < n - 1 && p.arr[i] < rel) i++;
          const prevDep = p.dep[i - 1];
          const f = Math.max(0, Math.min(1, (rel - prevDep) / (p.arr[i] - prevDep || 1)));
          const sa = this.xy.get(p.stations[i - 1])!, sb = this.xy.get(p.stations[i])!;
          out.push({ key: `M${p.id}-${d}`, mode: 'metro', lineId: p.line, color: line.color,
            x: sa[0] + (sb[0] - sa[0]) * f, z: sa[1] + (sb[1] - sa[1]) * f, heading: Math.atan2(sb[1] - sa[1], sb[0] - sa[0]),
            title: `${line.id === 'INTER' ? 'Inter-corridor' : line.id === 'BLUE' ? 'Blue Line' : 'Green Line'} train`,
            subtitle: `${this.stById.get(p.stations[0])!.name} to ${this.stById.get(p.stations[n - 1])!.name}`,
            nextStop: this.stById.get(p.stations[i])!.name, nextEta: d + p.arr[i] - t, note: 'Station-to-station run times are estimated', estimated: true, dir: p.dir });
        }
      }
    }
    if (modes.bus) {
      for (const r of this.net.busRoutes) {
        const pl = this.busPoly.get(r.id)!;
        const speed = r.assumption.speedKmh / 3600; // km per second
        const dur = pl.len / speed;
        const first = hhmm(r.assumption.firstDep), last = hhmm(r.assumption.lastDep), hw = r.assumption.headwayMin * 60;
        for (const rev of [false, true]) {
          const off = rev ? hw / 2 : 0;
          const k0 = Math.max(0, Math.ceil((t - dur - first - off) / hw));
          for (let k = k0; ; k++) {
            const dep = first + off + k * hw;
            if (dep > t || dep > last) break;
            const f = (t - dep) / dur;
            if (f < 0 || f > 1) continue;
            const pos = at(pl, (rev ? 1 - f : f) * pl.len);
            const stops = this.busStopD.get(r.id)!;
            const dist = (rev ? 1 - f : f) * pl.len;
            let ni = rev ? stops.findLastIndex((c) => c < dist - 1e-6) : stops.findIndex((c) => c > dist + 1e-6);
            if (ni < 0) ni = rev ? 0 : stops.length - 1;
            out.push({ key: `B${r.id}${rev ? 'r' : 'f'}${k}`, mode: 'bus', lineId: r.id, color: r.color, x: pos.x, z: pos.z,
              heading: pos.heading + (rev ? Math.PI : 0), title: `Bus ${r.id}`,
              subtitle: rev ? `${r.destination} to ${r.origin}` : `${r.origin} to ${r.destination}`,
              nextStop: r.stops[ni].name, nextEta: null, note: 'Simulated bus. Frequency and speed are assumptions.', estimated: true, dir: rev ? 'B' : 'F' });
          }
        }
      }
    }
    return out;
  }

  /** Next departures from a rail or metro station. */
  nextDepartures(stationId: string, day: 'weekday' | 'saturday' | 'sunday', t: number, count = 5) {
    const rail = this.net.lines.find((l) => l.id === 'SUB')!;
    const res: { when: number; text: string; est: boolean }[] = [];
    const ri = rail.stationIds.indexOf(stationId);
    if (ri >= 0) {
      for (const trip of this.subTrips(day)) {
        for (let k = 0; k < trip.s.length - 1; k++) {
          if (trip.s[k] === ri) {
            const w = trip.t[k];
            if (w >= t) res.push({ when: w, text: `${trip.id.replace('R', '')}  ${trip.label.replace(/^\S+ /, '')}`, est: !trip.pub.includes(ri) });
            break;
          }
        }
      }
    } else {
      for (const p of this.patterns(day)) {
        const i = p.stations.indexOf(stationId);
        if (i < 0 || i === p.stations.length - 1) continue;
        for (const d of p.departures) {
          const w = d + p.dep[i];
          if (w >= t) { res.push({ when: w, text: `${p.line === 'BLUE' ? 'Blue' : p.line === 'GREEN' ? 'Green' : 'Inter'} to ${this.stById.get(p.stations[p.stations.length - 1])!.name.replace('Puratchi Thalaivar Dr. M.G. Ramachandran Central', 'Central').replace('Chennai International Airport', 'Airport')}`, est: true }); break; }
        }
      }
    }
    return res.sort((a, b) => a.when - b.when).slice(0, count);
  }

  busFare(r: BusRoute) { return r.ordinaryFareInr; }
}
