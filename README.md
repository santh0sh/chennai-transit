# chennai-transit

A private, original isometric simulation of Chennai's public transport: MTC buses, Southern Railway suburban trains and CMRL Metro on one map.

**It is a simulation, not live tracking.** No public live feed exists for Chennai (the Chennai One app's bus tracking is not offered as open data). Vehicles move according to official timetable data, and the screen says so.

## How it works

```
data/raw/*.csv  --(Java 21 importer: parse, validate)-->  data/build/network.v1.json  -->  web/ (React + Three.js)
```

Example: the raw row `40501, 03:50 Beach, 04:50 Tambaram, 05:40 Chengalpattu` becomes a trip with a time at all 28 stations. Beach, Tambaram and Chengalpattu times are as published. The stations in between are estimated and flagged.

## Data and honesty rules

| Mode | Source | What is official | What is estimated |
|---|---|---|---|
| Suburban | Southern Railway revision w.e.f. 01 Jun 2026 | Beach, Tambaram, Chengalpattu times, train numbers | Stops in between, spread using an older official run-time sheet |
| Metro | CMRL first/last train + frequency bands (page dated 2 Jul 2026) | First and last trains, headways | Run time between stations |
| Bus | MTC route and stage list, 2018 fare chart | Stage order, ordinary fares | Stop positions, all frequencies and speeds (assumptions in `data/raw/bus-assumptions.csv`) |

Known data notes (also shown in the app): the suburban timetable was transcribed from a newspaper reproduction of the Southern Railway press release because the official 2026 PDF was not found; the Sunday down table has 93 rows against 97 stated; two trains that run only beyond Chengalpattu are skipped. Station positions come from OpenStreetMap (ODbL) or are marked `approx`.

No passenger counts are shown. Community GTFS feeds were not used (stale, unverified).

## Run it

```bash
# 1. importer (needs JDK 21 and Maven)
cd importer && mvn package
java -jar target/timetable-importer-0.1.0.jar ../data/raw ../data/build/network.v1.json 2026-10-08.1
cp ../data/build/network.v1.json ../web/public/data/

# 2. web
cd ../web && npm install && npm run dev
```

`tools/extract_suburban.py` is the one-off helper that copied the suburban tables into `data/raw`.

## Later

A live layer can plug in if the CUMTA open-data portal (opendata.cumta.org) ever publishes a licensed feed. Nothing here calls CUMTA or any private app endpoint.
