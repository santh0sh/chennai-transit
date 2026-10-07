package in.chennaitransit.importer;

import in.chennaitransit.importer.Model.*;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** Usage: Main <raw-data-dir> <output.json> [dataVersion] */
public final class Main {
    private Main() {}

    public static void main(String[] args) throws IOException {
        if (args.length < 2) { System.err.println("usage: Main <raw-dir> <out.json> [version]"); System.exit(2); }
        Path raw = Path.of(args[0]);
        String version = args.length > 2 ? args[2] : "dev";

        List<Station> all = new ArrayList<>();
        for (Map<String, String> r : Csv.read(raw.resolve("stations.csv"))) {
            all.add(new Station(r.get("id"), r.get("name"), r.get("mode").equals("rail") ? Mode.RAIL : Mode.METRO,
                    Double.parseDouble(r.get("lat")), Double.parseDouble(r.get("lon")), r.get("coordSource")));
        }
        Map<String, Station> byId = new LinkedHashMap<>();
        all.forEach(s -> byId.put(s.id(), s));
        List<Station> rail = all.stream().filter(s -> s.mode() == Mode.RAIL).toList();

        Validator v = new Validator();
        v.stations(byId);

        SuburbanImporter sub = new SuburbanImporter(rail, raw.resolve("suburban-runtimes.csv"));
        List<String> railIds = rail.stream().map(Station::id).toList();
        Map<String, List<Trip>> subSets = new LinkedHashMap<>();
        List<Trip> monsat = new ArrayList<>(sub.importTable(raw.resolve("suburban-weekday-down.csv"), true, "sub-monsat-down"));
        monsat.addAll(sub.importTable(raw.resolve("suburban-weekday-up.csv"), false, "sub-monsat-up"));
        List<Trip> sun = new ArrayList<>(sub.importTable(raw.resolve("suburban-sunday-down.csv"), true, "sub-sun-down"));
        sun.addAll(sub.importTable(raw.resolve("suburban-sunday-up.csv"), false, "sub-sun-up"));
        subSets.put("sub-monsat", monsat);
        subSets.put("sub-sun", sun);
        v.trips("sub-monsat", monsat, railIds.size(), 106);
        v.trips("sub-sun", sun, railIds.size(), 97);
        v.warnings.addAll(sub.warnings);

        MetroImporter metro = new MetroImporter(byId);
        List<MetroImporter.Service> services = metro.readServices(raw.resolve("metro-services.csv"));
        Map<String, List<Pattern>> metroByDay = metro.build(services, raw.resolve("cmrl-timetable.csv"));
        metroByDay.forEach(v::patterns);
        v.warnings.addAll(metro.warnings);

        BusImporter bus = new BusImporter();
        List<BusRoute> routes = bus.build(raw.resolve("mtc-routes.csv"), raw.resolve("mtc-stage-coords.csv"),
                raw.resolve("bus-assumptions.csv"), raw.resolve("mtc-fares-ordinary.csv"));
        v.buses(routes);
        v.warnings.addAll(bus.warnings);

        if (!v.errors.isEmpty()) {
            v.errors.forEach(e -> System.err.println("ERROR: " + e));
            System.exit(1);
        }

        List<Object> stationsJson = new ArrayList<>();
        for (Station s : all) {
            stationsJson.add(Json.obj("id", s.id(), "name", s.name(), "mode", s.mode().name().toLowerCase(),
                    "lat", s.lat(), "lon", s.lon(), "coordSource", s.coordSource()));
        }
        List<Object> lines = new ArrayList<>();
        lines.add(Json.obj("id", "SUB", "mode", "rail", "name", "Chennai Beach - Tambaram - Chengalpattu (Southern Railway suburban)",
                "color", "#c2410c", "stationIds", railIds, "draw", true));
        for (MetroImporter.Service s : services) {
            lines.add(Json.obj("id", s.id(), "mode", "metro", "name", s.name(), "color", s.color(),
                    "stationIds", s.stationIds(), "draw", !s.id().equals("INTER")));
        }

        Map<String, Object> tripSets = new LinkedHashMap<>();
        for (var e : subSets.entrySet()) {
            List<Object> list = new ArrayList<>();
            for (Trip t : e.getValue()) {
                list.add(Json.obj("id", t.id(), "dir", t.dir(), "label", t.label(), "note", t.note(),
                        "s", t.stationIdx(), "t", t.seconds(),
                        "pub", SuburbanImporter.publishedStations(t, railIds)));
            }
            tripSets.put(e.getKey(), list);
        }
        Map<String, Object> patternSets = new LinkedHashMap<>();
        for (String day : List.of("weekday", "saturday", "sunday")) {
            List<Object> list = new ArrayList<>();
            for (Pattern p : metroByDay.get(day)) {
                list.add(Json.obj("id", p.id(), "line", p.line(), "dir", p.dir(), "stations", p.stationIds(),
                        "arr", p.arrOffset(), "dep", p.depOffset(), "departures", p.departures()));
            }
            patternSets.put("metro-" + day, list);
        }
        List<Object> busJson = new ArrayList<>();
        for (BusRoute r : routes) {
            List<Object> stops = new ArrayList<>();
            for (BusStop s : r.stops()) stops.add(Json.obj("name", s.name(), "lat", s.lat(), "lon", s.lon(), "coordSource", s.coordSource()));
            busJson.add(Json.obj("id", r.id(), "origin", r.origin(), "destination", r.destination(), "color", r.color(),
                    "stops", stops, "mtcPageUpdated", r.mtcPageUpdated(), "ordinaryFareInr", r.ordinaryFareInr(),
                    "assumption", Json.obj("firstDep", r.firstDep(), "lastDep", r.lastDep(), "headwayMin", r.headwayMin(),
                            "speedKmh", r.speedKmh(), "note", "Illustrative only. MTC publishes no per-trip timetable.")));
        }

        List<Object> sources = List.of(
                Json.obj("id", "sr", "publisher", "Southern Railway, Chennai Division",
                        "title", "Revised suburban EMU timetable, Chennai Beach - Tambaram - Chengalpattu, w.e.f. 01.06.2026 (Press Release PUB/MAS/2026/05/25, 30.05.2026)",
                        "url", "https://indianexpress.com/article/india/southern-railway-changes-timings-of-over-200-chennai-suburban-trains-from-june-1-full-list-10715500/",
                        "kind", "official data, transcribed from a newspaper reproduction",
                        "note", "The official PDF for the 2026 revision was not found. Beach, Tambaram and Chengalpattu times are as published; stations between them are estimated."),
                Json.obj("id", "sr-runtime", "publisher", "Southern Railway",
                        "title", "Beach - Tambaram - Chengalpattu down weekdays sheet (older official sheet, run-time spacing only)",
                        "url", "https://sr.indianrailways.gov.in/cris//uploads/files/1563341095383-2-15%20MSB-TBM-CGL%20DOWN%20WEEK%20DAYS.pdf",
                        "kind", "official, used for station spacing only", "note", "Not used for any departure time."),
                Json.obj("id", "cmrl", "publisher", "Chennai Metro Rail Limited",
                        "title", "First and last train timings and frequency bands (page updated 2 July 2026)",
                        "url", "https://chennaimetrorail.org/wp-content/uploads/2026/07/first-and-last-train-timings_terminal_NP7P6_SL_WK_EP-NP7P6_SAT1-NP10P7_SUN1_1.pdf",
                        "kind", "official", "note", "No per-station times are published. Run times between stations are estimated."),
                Json.obj("id", "mtc", "publisher", "Metropolitan Transport Corporation (Chennai) Ltd",
                        "title", "Route Information (stages per route, pages updated 07-08-2026) and stage-wise fare chart (G.O. 48 dated 28.01.2018)",
                        "url", "https://mtcbus.tn.gov.in/Home/routewiseinfo",
                        "kind", "official", "note", "Stage order is official. Stop coordinates are approximate. Fares come from a 2018 tariff and may have changed."),
                Json.obj("id", "osm", "publisher", "OpenStreetMap contributors",
                        "title", "Station coordinates", "url", "https://www.openstreetmap.org/copyright",
                        "kind", "open data (ODbL)", "note", "Used for station positions only. Some positions are hand-approximated and marked approx."));

        Map<String, Object> dayTypes = Json.obj(
                "weekday", List.of("sub-monsat", "metro-weekday"),
                "saturday", List.of("sub-monsat", "metro-saturday"),
                "sunday", List.of("sub-sun", "metro-sunday"));

        Map<String, Object> root = Json.obj(
                "schemaVersion", 1,
                "dataVersion", version,
                "generatedAt", ZonedDateTime.now(ZoneId.of("Asia/Kolkata")).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
                "timezone", "Asia/Kolkata",
                "simulationNotice", "Vehicle positions are a SIMULATION driven by published timetable times. Not live tracking.",
                "sources", sources, "warnings", v.warnings, "stations", stationsJson, "lines", lines,
                "dayTypes", dayTypes, "tripSets", tripSets, "patternSets", patternSets, "busRoutes", busJson);

        Files.createDirectories(Path.of(args[1]).toAbsolutePath().getParent());
        Files.writeString(Path.of(args[1]), Json.write(root, false));
        System.out.printf("OK: %d stations, %d suburban weekday trips, %d sunday, %d bus routes, %d warnings%n",
                all.size(), monsat.size(), sun.size(), routes.size(), v.warnings.size());
        v.warnings.forEach(w -> System.out.println("WARN: " + w));
    }
}
