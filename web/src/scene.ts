import * as THREE from 'three';
import { project, Sim } from './sim';
import type { Mode, Vehicle } from './types';

const COAST: [number, number][] = [[13.40, 80.34], [13.26, 80.30], [13.18, 80.325], [13.12, 80.31], [13.07, 80.292], [13.03, 80.282], [12.99, 80.272], [12.95, 80.262], [12.90, 80.255], [12.82, 80.245], [12.70, 80.225], [12.60, 80.20]];
const LANDMARKS: { name: string; lat: number; lon: number }[] = [
  { name: 'Marina Beach', lat: 13.05, lon: 80.283 }, { name: 'Chennai Airport', lat: 12.9808, lon: 80.1642 }, { name: 'Guindy', lat: 13.0087, lon: 80.2126 },
];

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

export interface Pick { kind: 'vehicle' | 'station'; id: string }

export class CityScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  target = new THREE.Vector3(0, 0, 0);
  zoom = 9; // pixels per km multiplier base
  el: HTMLElement;
  labels: HTMLElement;
  sim: Sim;
  groups = { rail: new THREE.Group(), metro: new THREE.Group(), bus: new THREE.Group() };
  busRouteGroups = new Map<string, THREE.Object3D[]>();
  meshes: Record<Mode, THREE.InstancedMesh>;
  stationMeshes: { id: string; mode: Mode; pos: THREE.Vector3; mesh: THREE.Mesh }[] = [];
  vehicles: Vehicle[] = [];
  selected: Pick | null = null;
  selRing: THREE.Mesh;
  highlightRoute: string | null = null;
  onPick: (p: Pick | null) => void = () => {};
  private labelEls = new Map<string, HTMLElement>();
  private dragging = false; private last = [0, 0]; private moved = 0;
  private pointers = new Map<number, [number, number]>(); private pinch = 0;

  constructor(el: HTMLElement, labels: HTMLElement, sim: Sim) {
    this.el = el; this.labels = labels; this.sim = sim;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#f3ecdc');
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -500, 500);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#efe6d0', 2.1));
    const sun = new THREE.DirectionalLight('#fff4e0', 0.9); sun.position.set(-30, 60, 20); this.scene.add(sun);
    Object.values(this.groups).forEach((g) => this.scene.add(g));
    this.buildGround(); this.buildBuildings(); this.buildLines(); this.buildStations();
    const mk = (geo: THREE.BufferGeometry, n: number) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), n); m.count = 0; m.frustumCulled = false; this.scene.add(m); return m; };
    this.meshes = {
      rail: mk(new THREE.BoxGeometry(0.42, 0.16, 0.2), 400), metro: mk(new THREE.BoxGeometry(0.34, 0.14, 0.16), 400), bus: mk(new THREE.BoxGeometry(0.28, 0.1, 0.12), 400),
    };
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 32), new THREE.MeshBasicMaterial({ color: '#111', side: THREE.DoubleSide }));
    this.selRing.rotation.x = -Math.PI / 2; this.selRing.visible = false; this.scene.add(this.selRing);
    // start centred between Central and Guindy
    const [cx, cz] = project(13.03, 80.22); this.target.set(cx, 0, cz);
    this.zoom = 38;
    this.bindEvents(); this.resize();
  }

  private buildGround() {
    const land = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: '#f1e8d3' }));
    land.rotation.x = -Math.PI / 2; land.position.y = -0.02; this.scene.add(land);
    const pts = COAST.map(([la, lo]) => project(la, lo));
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], -pts[0][1]);
    pts.forEach(([x, z]) => shape.lineTo(x, -z));
    shape.lineTo(pts[pts.length - 1][0] + 80, -pts[pts.length - 1][1]); shape.lineTo(pts[0][0] + 80, -pts[0][1]); shape.closePath();
    const sea = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#cfe2e6' }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = -0.01; this.scene.add(sea);
  }

  private coastX(z: number) { // east limit (world x) of land at world z
    const pts = COAST.map(([la, lo]) => project(la, lo));
    for (let i = 1; i < pts.length; i++) { if (z <= pts[i][1] && z >= pts[i - 1][1]) { const f = (z - pts[i - 1][1]) / (pts[i][1] - pts[i - 1][1]); return pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]); } }
    return pts[0][0];
  }

  private buildBuildings() {
    const r = rng(7);
    const segs: [number, number, number, number][] = [];
    this.sim.net.lines.filter((l) => l.draw).forEach((l) => { const p = this.sim.linePoly.get(l.id)!; for (let i = 1; i < p.pts.length; i++) segs.push([p.pts[i - 1][0], p.pts[i - 1][1], p.pts[i][0], p.pts[i][1]]); });
    const near = (x: number, z: number) => segs.some(([ax, az, bx, bz]) => { const dx = bx - ax, dz = bz - az; const f = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - (ax + f * dx), z - (az + f * dz)) < 0.28; });
    const centres = [project(13.08, 80.27), project(12.93, 80.12), project(13.05, 80.22), project(13.0, 80.2), project(13.12, 80.29)];
    const items: { x: number; z: number; w: number; d: number; h: number; c: string }[] = [];
    const [minx, maxx] = [project(12.7, 79.95)[0], project(13.2, 80.32)[0]];
    const [minz, maxz] = [project(13.2, 80)[1], project(12.68, 80)[1]];
    const pal = ['#f7f0e0', '#efe4cc', '#f4ead5', '#e8dcc2', '#faf5e8', '#e3d6b8'];
    for (let n = 0; n < 26000 && items.length < 4200; n++) {
      const x = minx + r() * (maxx - minx), z = minz + r() * (maxz - minz);
      if (x > this.coastX(z) - 0.2) continue;
      let dens = 0.03; for (const [cx, cz] of centres) dens += 1.0 * Math.exp(-Math.hypot(x - cx, z - cz) / 6);
      if (r() > Math.min(1, dens * 0.55)) continue;
      if (near(x, z)) continue;
      const w = 0.1 + r() * 0.16, d = 0.1 + r() * 0.16;
      items.push({ x, z, w, d, h: 0.05 + Math.pow(r(), 2.4) * (0.08 + dens * 0.35), c: pal[Math.floor(r() * pal.length)] });
    }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#fff' }), items.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    items.forEach((b, i) => { m.compose(new THREE.Vector3(b.x, b.h / 2, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d)); mesh.setMatrixAt(i, m); mesh.setColorAt(i, col.set(b.c)); });
    this.scene.add(mesh);
  }

  private ribbon(pts: [number, number][], width: number, y: number, color: string, opacity = 1) {
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      pos.push(pts[i][0] - dz * width / 2, y, pts[i][1] + dx * width / 2, pts[i][0] + dz * width / 2, y, pts[i][1] - dx * width / 2);
      if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: opacity < 1, opacity }));
  }

  private buildLines() {
    for (const l of this.sim.net.lines) {
      if (!l.draw) continue;
      const p = this.sim.linePoly.get(l.id)!;
      const g = l.mode === 'rail' ? this.groups.rail : this.groups.metro;
      if (l.mode === 'rail') { g.add(this.ribbon(p.pts, 0.34, 0.012, '#8a6b57')); g.add(this.ribbon(p.pts, 0.2, 0.02, l.color)); }
      else g.add(this.ribbon(p.pts, 0.26, 0.03 + (l.id === 'GREEN' ? 0.004 : 0), l.color));
    }
    for (const r of this.sim.net.busRoutes) {
      const pl = this.sim.busPoly.get(r.id)!;
      const rib = this.ribbon(pl.pts, 0.12, 0.04, r.color, 0.9);
      this.groups.bus.add(rib);
      const stops: THREE.Object3D[] = [];
      r.stops.forEach((s) => { const [x, z] = project(s.lat, s.lon); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 12), new THREE.MeshBasicMaterial({ color: r.color })); m.position.set(x, 0.06, z); m.visible = false; this.groups.bus.add(m); stops.push(m); });
      this.busRouteGroups.set(r.id, [rib, ...stops]);
    }
  }

  private buildStations() {
    for (const s of this.sim.net.stations) {
      const [x, z] = this.sim.xy.get(s.id)!;
      const mode: Mode = s.mode;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(mode === 'metro' ? 0.26 : 0.22, 0.26, 0.1, 16), new THREE.MeshLambertMaterial({ color: '#fffdf6' }));
      m.position.set(x, mode === 'metro' ? 0.09 : 0.06, z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 8, 20), new THREE.MeshBasicMaterial({ color: mode === 'metro' ? '#1f3b73' : '#c2410c' }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; m.add(ring);
      this.groups[mode].add(m);
      this.stationMeshes.push({ id: s.id, mode, pos: m.position.clone(), mesh: m });
    }
  }

  setVisible(modes: { rail: boolean; metro: boolean; bus: boolean }) { this.groups.rail.visible = modes.rail; this.groups.metro.visible = modes.metro; this.groups.bus.visible = modes.bus; }

  setHighlightRoute(id: string | null) {
    this.highlightRoute = id;
    for (const [rid, objs] of this.busRouteGroups) objs.forEach((o, i) => { if (i === 0) (o as THREE.Mesh).material = new THREE.MeshBasicMaterial({ color: this.sim.net.busRoutes.find((r) => r.id === rid)!.color, side: THREE.DoubleSide, transparent: true, opacity: id === null || id === rid ? 0.95 : 0.25 }); else o.visible = id === rid; });
  }

  update(vehicles: Vehicle[]) {
    this.vehicles = vehicles;
    const counts: Record<Mode, number> = { rail: 0, metro: 0, bus: 0 };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    for (const v of vehicles) {
      if (this.highlightRoute && v.mode === 'bus' && v.lineId !== this.highlightRoute) { /* dim buses of other routes */ }
      const mesh = this.meshes[v.mode]; const i = counts[v.mode]++; if (i >= 400) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -v.heading);
      const y = v.mode === 'metro' ? 0.2 : v.mode === 'rail' ? 0.14 : 0.1;
      m.compose(new THREE.Vector3(v.x, y, v.z), q, new THREE.Vector3(1.5, 1.5, 1.5));
      mesh.setMatrixAt(i, m); mesh.setColorAt(i, col.set(this.highlightRoute && v.mode === 'bus' && v.lineId !== this.highlightRoute ? '#d8d0bd' : v.color));
    }
    (Object.keys(counts) as Mode[]).forEach((k) => { const mesh = this.meshes[k]; mesh.count = Math.min(400, counts[k]); mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.visible = this.groups[k].visible; });
  }

  private screen(p: THREE.Vector3): [number, number] { const v = p.clone().project(this.camera); const r = this.renderer.domElement.getBoundingClientRect(); return [(v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height]; }

  render() {
    const sel = this.selected;
    this.selRing.visible = false;
    if (sel) {
      const pos = sel.kind === 'vehicle' ? (() => { const v = this.vehicles.find((x) => x.key === sel.id); return v ? new THREE.Vector3(v.x, 0.3, v.z) : null; })() : this.stationMeshes.find((s) => s.id === sel.id)?.pos.clone() ?? null;
      if (pos) { this.selRing.position.set(pos.x, 0.35, pos.z); const s = 22 / this.zoom * 1.0 + 0.4; this.selRing.scale.setScalar(s); this.selRing.visible = true; }
    }
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }

  private updateLabels() {
    const show = new Set<string>();
    const sel = this.selected;
    for (const s of this.stationMeshes) {
      if (!this.groups[s.mode].visible) continue;
      const important = ['MSB', 'TBM', 'CGL', 'GDY', 'CEN', 'APT', 'WND', 'STMM', 'ALD', 'KYB'].includes(s.id);
      if (this.zoom > 70 || (important && this.zoom > 12) || (sel?.kind === 'station' && sel.id === s.id)) show.add(s.id);
    }
    for (const lm of LANDMARKS) show.add('lm:' + lm.name);
    const mk = (key: string, text: string, cls: string) => { let e = this.labelEls.get(key); if (!e) { e = document.createElement('div'); e.className = cls; e.textContent = text; this.labels.appendChild(e); this.labelEls.set(key, e); } return e; };
    for (const [key, e] of this.labelEls) if (!show.has(key)) e.style.display = 'none';
    const vw = this.el.clientWidth, vh = this.el.clientHeight;
    for (const s of this.stationMeshes) {
      if (!show.has(s.id)) continue;
      const st = this.sim.stById.get(s.id)!;
      const e = mk(s.id, st.name.replace('Puratchi Thalaivar Dr. M.G. Ramachandran Central', 'Central').replace('Chennai International Airport', 'Airport'), 'lbl');
      const [x, y] = this.screen(s.pos);
      if (x < -50 || y < -20 || x > vw + 50 || y > vh + 20) { e.style.display = 'none'; continue; }
      e.style.display = 'block'; e.style.transform = `translate(${x + 8}px, ${y - 16}px)`;
    }
    for (const lm of LANDMARKS) {
      const e = mk('lm:' + lm.name, lm.name, 'lbl lm'); const [px, pz] = project(lm.lat, lm.lon);
      const [x, y] = this.screen(new THREE.Vector3(px + (lm.name === 'Marina Beach' ? 1.2 : 0), 0, pz));
      e.style.display = x < 0 || y < 0 || x > vw || y > vh ? 'none' : 'block'; e.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.renderer.setSize(w, h);
    this.applyCamera();
  }

  applyCamera() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const s = this.zoom;
    this.camera.left = -w / 2 / s; this.camera.right = w / 2 / s; this.camera.top = h / 2 / s; this.camera.bottom = -h / 2 / s;
    this.camera.updateProjectionMatrix();
    const az = Math.PI / 4, el = (35 * Math.PI) / 180, dist = 200;
    this.camera.position.set(this.target.x + Math.cos(az) * Math.cos(el) * dist, Math.sin(el) * dist, this.target.z + Math.sin(az) * Math.cos(el) * dist);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  private bindEvents() {
    const c = this.renderer.domElement;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, [e.clientX, e.clientY]); this.dragging = true; this.moved = 0; this.last = [e.clientX, e.clientY]; if (this.pointers.size === 2) this.pinch = this.pinchDist(); });
    c.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.pointers.size === 2) { const d = this.pinchDist(); if (this.pinch) this.setZoom(this.zoom * d / this.pinch); this.pinch = d; this.moved += 10; return; }
      const dx = e.clientX - this.last[0], dy = e.clientY - this.last[1]; this.last = [e.clientX, e.clientY]; this.moved += Math.abs(dx) + Math.abs(dy);
      // pan along ground axes as seen from the isometric camera
      const k = 1 / this.zoom; const right = new THREE.Vector3(1, 0, -1).normalize(); const fwd = new THREE.Vector3(-1, 0, -1).normalize();
      const f = 1 / Math.sin((35 * Math.PI) / 180);
      this.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k * f);
      this.applyCamera();
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId); this.pinch = 0;
      if (this.pointers.size === 0 && this.dragging && this.moved < 6) this.pickAt(e.clientX, e.clientY);
      if (this.pointers.size === 0) this.dragging = false;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    window.addEventListener('resize', () => this.resize());
  }
  private pinchDist() { const p = [...this.pointers.values()]; return Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]); }
  setZoom(z: number) { this.zoom = Math.max(3, Math.min(120, z)); this.applyCamera(); }

  focus(x: number, z: number, zoom?: number) { this.target.set(x, 0, z); if (zoom) this.zoom = zoom; this.applyCamera(); }

  private pickAt(cx: number, cy: number) {
    const r = this.renderer.domElement.getBoundingClientRect(); const px = cx - r.left, py = cy - r.top;
    let best: Pick | null = null, bd = 18;
    for (const v of this.vehicles) { if (!this.groups[v.mode].visible) continue; const [x, y] = this.screen(new THREE.Vector3(v.x, 0.15, v.z)); const d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = { kind: 'vehicle', id: v.key }; } }
    if (!best) { bd = 16; for (const s of this.stationMeshes) { if (!this.groups[s.mode].visible) continue; const [x, y] = this.screen(s.pos); const d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = { kind: 'station', id: s.id }; } } }
    this.selected = best; this.onPick(best);
  }
                           }
