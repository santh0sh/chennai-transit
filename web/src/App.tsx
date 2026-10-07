import { useEffect, useMemo, useRef, useState } from 'react';
import { CityScene, type Pick } from './scene';
import { Sim, dayTypeOf, fmtClock, fmtHM, project } from './sim';
import type { Network, Vehicle, Mode } from './types';

const MODE_INFO: Record<Mode, { label: string; color: string }> = {
  rail: { label: 'Suburban rail', color: '#c2410c' }, metro: { label: 'Metro', color: '#2f6fdb' }, bus: { label: 'MTC bus', color: '#d97706' },
};
const SPEEDS = [1, 10, 60, 300];

export default function App() {
  const [net, setNet] = useState<Network | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { fetch('./data/network.v1.json').then((r) => r.json()).then(setNet).catch((e) => setErr(String(e))); }, []);
  if (err) return <div className="boot">Could not load timetable data: {err}</div>;
  if (!net) return <div className="boot">Loading timetable data...</div>;
  return <Main net={net} />;
}

function Main({ net }: { net: Network }) {
  const sim = useMemo(() => new Sim(net), [net]);
  const mount = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const scene = useRef<CityScene | null>(null);
  const clock = useRef({ epoch: Date.now(), speed: 60, playing: true, last: performance.now() });
  const modesRef = useRef({ rail: true, metro: true, bus: true });
  const [modes, setModes] = useState(modesRef.current);
  const [speed, setSpeed] = useState(60);
  const [playing, setPlaying] = useState(true);
  const [tick, setTick] = useState(0);
  const [sel, setSel] = useState<Pick | null>(null);
  const [route, setRoute] = useState<string | null>(null);
  const [counts, setCounts] = useState({ rail: 0, metro: 0, bus: 0 });
  const vehiclesRef = useRef<Vehicle[]>([]);
  const [selVehicle, setSelVehicle] = useState<Vehicle | null>(null);

  useEffect(() => {
    const sc = new CityScene(mount.current!, labels.current!, sim);
    scene.current = sc;
    sc.onPick = (p) => { setSel(p); if (p?.kind !== 'vehicle') setSelVehicle(null); };
    (window as any).__scene = sc;
    let raf = 0, lastUi = 0;
    const loop = (now: number) => {
      const c = clock.current;
      if (c.playing) c.epoch += (now - c.last) * c.speed;
      c.last = now;
      const { day, secOfDay } = dayTypeOf(c.epoch);
      const vs = sim.vehicles(day, secOfDay, modesRef.current);
      vehiclesRef.current = vs;
      sc.update(vs); sc.render();
      if (now - lastUi > 250) {
        lastUi = now; setTick((t) => t + 1);
        setCounts({ rail: vs.filter((v) => v.mode === 'rail').length, metro: vs.filter((v) => v.mode === 'metro').length, bus: vs.filter((v) => v.mode === 'bus').length });
        const s = sc.selected; setSelVehicle(s?.kind === 'vehicle' ? vs.find((v) => v.key === s.id) ?? null : null);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim]);

  useEffect(() => { modesRef.current = modes; scene.current?.setVisible(modes); }, [modes]);
  useEffect(() => { clock.current.speed = speed; clock.current.playing = playing; }, [speed, playing]);
  useEffect(() => { scene.current?.setHighlightRoute(route); }, [route]);

  const { day, secOfDay, label } = dayTypeOf(clock.current.epoch);
  void tick;
  const setTime = (sec: number) => { const c = clock.current; c.epoch += (sec - dayTypeOf(c.epoch).secOfDay) * 1000; };
  const resetNow = () => { clock.current.epoch = Date.now(); };

  const selStation = sel?.kind === 'station' ? sim.stById.get(sel.id) : null;
  const busRoute = route ? net.busRoutes.find((r) => r.id === route) : null;
  const selectBus = (id: string | null) => {
    setRoute(id);
    if (id) { const r = net.busRoutes.find((x) => x.id === id)!; const m = r.stops[Math.floor(r.stops.length / 2)]; const [x, z] = project(m.lat, m.lon); scene.current?.focus(x, z, 42); }
  };

  return (
    <div className="app">
      <header>
        <div className="brand"><b>Chennai Transit</b><span className="sim">SIMULATION</span><span className="priv">private preview</span></div>
        <div className="clock"><span className="time">{fmtClock(secOfDay)}</span><span className="ist">IST · {label}</span></div>
        <div className="counters">
          {(['rail', 'metro', 'bus'] as Mode[]).map((m) => (
            <button key={m} className={'chip' + (modes[m] ? ' on' : '')} onClick={() => setModes({ ...modes, [m]: !modes[m] })} style={{ ['--c' as any]: MODE_INFO[m].color }}>
              <i /> {MODE_INFO[m].label} <b>{modes[m] ? counts[m] : 0}</b>
            </button>
          ))}
        </div>
      </header>
      <div className="stage">
        <div className="canvas" ref={mount}><div className="labels" ref={labels} /></div>
        <aside>
          <section className="controls">
            <div className="row">
              <button className="btn" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
              {SPEEDS.map((s) => <button key={s} className={'btn' + (speed === s ? ' act' : '')} onClick={() => setSpeed(s)}>{s}x</button>)}
              <button className="btn" onClick={resetNow}>Now</button>
            </div>
            <input type="range" min={0} max={86399} value={secOfDay} onChange={(e) => setTime(Number(e.target.value))} aria-label="Time of day" />
            <div className="hint">Day type: <b>{day}</b>. Drag the slider to jump around the day.</div>
          </section>
          {selVehicle && (
            <section className="card">
              <h3 style={{ borderColor: selVehicle.color }}>{selVehicle.title}</h3>
              <p className="sub">{selVehicle.subtitle}</p>
              <dl><dt>Next stop</dt><dd>{selVehicle.nextStop}{selVehicle.nextEta !== null ? ` in ${Math.max(0, Math.round(selVehicle.nextEta / 60))} min` : ''}</dd>
                <dt>Position</dt><dd>Simulated{selVehicle.estimated ? ' (this leg estimated)' : ' (between published times)'}</dd></dl>
              {selVehicle.note && <p className="note">{selVehicle.note}</p>}
            </section>
          )}
          {selStation && (
            <section className="card">
              <h3 style={{ borderColor: MODE_INFO[selStation.mode].color }}>{selStation.name}</h3>
              <p className="sub">{selStation.mode === 'metro' ? 'Chennai Metro station' : 'Suburban railway station'}</p>
              <p className="subh">Next departures</p>
              <ul className="dep">{sim.nextDepartures(selStation.id, day, secOfDay, 6).map((d, i) => <li key={i}><b>{fmtHM(d.when)}</b> {d.text}{d.est ? <em> est.</em> : null}</li>)}
                {sim.nextDepartures(selStation.id, day, secOfDay, 6).length === 0 && <li>No more departures today in the data.</li>}</ul>
              <p className="note">{selStation.coordSource === 'osm' ? 'Position from OpenStreetMap.' : 'Position approximate.'}</p>
            </section>
          )}
          <section className="card">
            <h3>MTC bus routes</h3>
            <div className="routes">{net.busRoutes.map((r) => <button key={r.id} className={'route' + (route === r.id ? ' act' : '')} style={{ ['--c' as any]: r.color }} onClick={() => selectBus(route === r.id ? null : r.id)}>{r.id}</button>)}</div>
            {busRoute ? (
              <div>
                <p className="sub">{busRoute.origin} to {busRoute.destination}</p>
                <dl><dt>Stages</dt><dd>{busRoute.stops.length} (official MTC list)</dd><dt>Ordinary fare end to end</dt><dd>Rs {busRoute.ordinaryFareInr} (2018 tariff, may differ now)</dd>
                  <dt>Frequency shown</dt><dd>every {busRoute.assumption.headwayMin} min, {busRoute.assumption.firstDep} to {busRoute.assumption.lastDep} (assumed)</dd></dl>
                <ol className="stages">{busRoute.stops.map((s, i) => <li key={i}>{s.name}</li>)}</ol>
              </div>
            ) : <p className="hint">Pick a route to see its stages and fare.</p>}
          </section>
          <section className="card legend">
            <h3>How to read this</h3>
            <p>Moving blocks are a <b>simulation</b>. Suburban trains use the published Beach, Tambaram and Chengalpattu times; stations between them are estimated. Metro uses CMRL first/last train and frequency bands; run times are estimated. Bus movement is illustrative: MTC publishes routes and fares, not trip times.</p>
            <p className="note">No live data. No passenger counts. Data v{net.dataVersion}.</p>
            <details><summary>Sources and data notes</summary>
              <ul className="src">{net.sources.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.publisher}</a>: {s.title}. <em>{s.note}</em></li>)}</ul>
              {net.warnings.length > 0 && <ul className="warn">{net.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            </details>
          </section>
        </aside>
      </div>
    </div>
  );
}
