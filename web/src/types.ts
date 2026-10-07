export interface Station { id: string; name: string; mode: 'rail' | 'metro'; lat: number; lon: number; coordSource: string }
export interface Line { id: string; mode: 'rail' | 'metro'; name: string; color: string; stationIds: string[]; draw: boolean }
export interface SubTrip { id: string; dir: string; label: string; note: string; s: number[]; t: number[]; pub: number[] }
export interface Pattern { id: string; line: string; dir: string; stations: string[]; arr: number[]; dep: number[]; departures: number[] }
export interface BusStop { name: string; lat: number; lon: number; coordSource: string }
export interface BusRoute {
  id: string; origin: string; destination: string; color: string; stops: BusStop[]; mtcPageUpdated: string; ordinaryFareInr: number;
  assumption: { firstDep: string; lastDep: string; headwayMin: number; speedKmh: number; note: string };
}
export interface Source { id: string; publisher: string; title: string; url: string; kind: string; note: string }
export interface Network {
  schemaVersion: number; dataVersion: string; generatedAt: string; simulationNotice: string;
  sources: Source[]; warnings: string[]; stations: Station[]; lines: Line[];
  dayTypes: Record<string, string[]>; tripSets: Record<string, SubTrip[]>; patternSets: Record<string, Pattern[]>; busRoutes: BusRoute[];
}
export type Mode = 'rail' | 'metro' | 'bus';
export interface Vehicle {
  key: string; mode: Mode; lineId: string; color: string; x: number; z: number; heading: number;
  title: string; subtitle: string; nextStop: string; nextEta: number | null; note: string; estimated: boolean; dir: string;
}
