package in.chennaitransit.importer;

import in.chennaitransit.importer.Model.Pattern;
import in.chennaitransit.importer.Model.Station;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Expands the CMRL first/last train table and frequency bands into departure lists.
 * CMRL publishes no per-station times, so run times are ESTIMATED from station spacing.
 */
final class MetroImporter {
    static final double CRUISE_KMH = 36.0;
    static final double ROUTE_FACTOR = 1.15; // straight-line distance to track length
    static final int DWELL_SECONDS = 25;
    static final int HOP_PENALTY_SECONDS = 20; // acceleration and braking

    record Band(int from, int to, int headwayMin) {}

    private final Map<String, Station> stations;
    final List<String> warnings = new ArrayList<>();

    MetroImporter(Map<String, Station> stations) { this.stations = stations; }

    record Service(String id, String name, String color, List<String> stationIds) {}

    List<Service> readServices(Path csv) throws IOException {
        List<Service> out = new ArrayList<>();
        for (Map<String, String> r : Csv.read(csv)) {
            out.add(new Service(r.get("service"), r.get("name"), r.get("color"),
                    List.of(r.get("stations").trim().split("\\s+"))));
        }
        return out;
    }

    /** Returns patterns by day type. */
    Map<String, List<Pattern>> build(List<Service> services, Path timetable) throws IOException {
        Map<String, List<Map<String, String>>> byDay = new HashMap<>();
        for (Map<String, String> r : Csv.read(timetable)) {
            byDay.computeIfAbsent(r.get("daytype"), k -> new ArrayList<>()).add(r);
        }
        Map<String, List<Pattern>> out = new HashMap<>();
        for (String day : List.of("weekday", "saturday", "sunday")) {
            List<Pattern> patterns = new ArrayList<>();
            for (Service s : services) {
                for (boolean forward : new boolean[]{true, false}) {
                    List<String> ids = new ArrayList<>(s.stationIds());
                    if (!forward) java.util.Collections.reverse(ids);
                    String origin = ids.get(0);
                    Integer first = null, last = null;
                    List<Band> bands = new ArrayList<>();
                    for (Map<String, String> r : byDay.getOrDefault(day, List.of())) {
                        if (!r.get("service").equals(s.id())) continue;
                        switch (r.get("kind")) {
                            case "first" -> { if (r.get("a").equals(origin)) first = TimeParse.hhmm(r.get("b")); }
                            case "last" -> { if (r.get("a").equals(origin)) last = TimeParse.hhmm(r.get("b")); }
                            case "band" -> { if (forward) bands.add(new Band(TimeParse.hhmm(r.get("a")), TimeParse.hhmm(r.get("b")), Integer.parseInt(r.get("c")))); }
                            default -> throw new IllegalArgumentException("Unknown row kind " + r.get("kind"));
                        }
                    }
                    if (!forward) {
                        for (Map<String, String> r : byDay.getOrDefault(day, List.of())) {
                            if (r.get("service").equals(s.id()) && r.get("kind").equals("band")) {
                                bands.add(new Band(TimeParse.hhmm(r.get("a")), TimeParse.hhmm(r.get("b")), Integer.parseInt(r.get("c"))));
                            }
                        }
                    }
                    if (first == null || last == null || bands.isEmpty()) {
                        warnings.add("Metro " + s.id() + " " + day + " " + (forward ? "forward" : "reverse") + ": missing first/last/bands");
                        continue;
                    }
                    patterns.add(pattern(s, forward, ids, first, last, bands));
                }
            }
            out.put(day, patterns);
        }
        return out;
    }

    private Pattern pattern(Service s, boolean forward, List<String> ids, int first, int last, List<Band> bands) {
        int n = ids.size();
        int[] arr = new int[n];
        int[] dep = new int[n];
        for (int i = 1; i < n; i++) {
            Station a = stations.get(ids.get(i - 1));
            Station b = stations.get(ids.get(i));
            double km = Geo.haversineKm(a.lat(), a.lon(), b.lat(), b.lon()) * ROUTE_FACTOR;
            int hop = (int) Math.round(km / CRUISE_KMH * 3600) + HOP_PENALTY_SECONDS;
            arr[i] = dep[i - 1] + hop;
            dep[i] = i == n - 1 ? arr[i] : arr[i] + DWELL_SECONDS;
        }
        List<Integer> deps = new ArrayList<>();
        int t = first;
        while (t <= last) {
            deps.add(t);
            t += headwayAt(bands, t) * 60;
        }
        if (deps.get(deps.size() - 1) != last) deps.add(last);
        String dir = forward ? "F" : "B";
        return new Pattern(s.id() + "-" + dir, s.id(), dir, ids, arr, dep, deps, true);
    }

    static int headwayAt(List<Band> bands, int sec) {
        for (Band b : bands) if (sec >= b.from() && sec < b.to()) return b.headwayMin();
        return sec < bands.get(0).from() ? bands.get(0).headwayMin() : bands.get(bands.size() - 1).headwayMin();
    }
}
