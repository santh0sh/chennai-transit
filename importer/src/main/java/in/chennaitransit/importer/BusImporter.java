package in.chennaitransit.importer;

import in.chennaitransit.importer.Model.BusRoute;
import in.chennaitransit.importer.Model.BusStop;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Builds bus routes from the MTC route/stage listing, our stop coordinates and explicit assumptions. */
final class BusImporter {
    final List<String> warnings = new ArrayList<>();

    List<BusRoute> build(Path routes, Path coords, Path assumptions, Path fares) throws IOException {
        Map<String, Map<String, String>> xy = new HashMap<>();
        for (Map<String, String> r : Csv.read(coords)) xy.put(r.get("stage"), r);
        Map<String, Map<String, String>> assume = new LinkedHashMap<>();
        for (Map<String, String> r : Csv.read(assumptions)) assume.put(r.get("route"), r);
        Map<Integer, Integer> fare = new HashMap<>();
        for (Map<String, String> r : Csv.read(fares)) fare.put(Integer.parseInt(r.get("stagesTravelled")), Integer.parseInt(r.get("ordinaryFareInr")));

        Map<String, List<Map<String, String>>> byRoute = new LinkedHashMap<>();
        for (Map<String, String> r : Csv.read(routes)) byRoute.computeIfAbsent(r.get("route"), k -> new ArrayList<>()).add(r);

        List<BusRoute> out = new ArrayList<>();
        for (var e : byRoute.entrySet()) {
            String id = e.getKey();
            List<BusStop> stops = new ArrayList<>();
            String updated = "";
            for (Map<String, String> r : e.getValue()) {
                Map<String, String> c = xy.get(r.get("stage"));
                if (c == null) { warnings.add("Bus " + id + ": no coordinates for stage " + r.get("stage")); continue; }
                stops.add(new BusStop(titleCase(r.get("stage")), Double.parseDouble(c.get("lat")), Double.parseDouble(c.get("lon")), c.get("coordSource")));
                updated = r.get("mtcPageUpdated");
            }
            Map<String, String> a = assume.get(id);
            if (a == null) { warnings.add("Bus " + id + ": no service assumptions row"); continue; }
            int travelled = Math.max(1, Math.min(30, stops.size() - 1));
            out.add(new BusRoute(id, stops.get(0).name(), stops.get(stops.size() - 1).name(), a.get("color"), stops, updated,
                    fare.getOrDefault(travelled, -1), a.get("firstDep"), a.get("lastDep"),
                    Integer.parseInt(a.get("headwayMin")), Integer.parseInt(a.get("speedKmh"))));
        }
        return out;
    }

    static String titleCase(String s) {
        StringBuilder sb = new StringBuilder();
        boolean up = true;
        for (char c : s.toLowerCase().toCharArray()) {
            sb.append(up && Character.isLetter(c) ? Character.toUpperCase(c) : c);
            up = c == ' ' || c == '.' || c == '-' || c == '/' || c == '&';
        }
        return sb.toString().replace("Mgr", "MGR").replace("Ymia", "YMIA").replace("T.b.", "T.B.");
    }
}
