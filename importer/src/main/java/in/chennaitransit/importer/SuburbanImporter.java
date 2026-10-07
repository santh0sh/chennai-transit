package in.chennaitransit.importer;

import in.chennaitransit.importer.Model.Station;
import in.chennaitransit.importer.Model.Trip;
import in.chennaitransit.importer.TimeParse.Cell;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns the transcribed Southern Railway tables (Beach - Tambaram - Chengalpattu, w.e.f. 01 Jun 2026)
 * into trips with a time at every station.
 *
 * Only Beach, Tambaram, Chengalpattu (and Guindy for short workings) carry published times.
 * Every station in between is estimated by spreading the published time across the older official
 * run-time sheet. Trips are flagged so the UI can say so.
 */
final class SuburbanImporter {
    static final String LINE_ID = "SUB";
    private static final Pattern GI_RETURN = Pattern.compile("^GI/(\\d{1,2}:\\d{2})$");
    private static final Pattern GI_ORIGIN = Pattern.compile("^GI( D)?:(\\d{1,2}:\\d{2})$");

    private final List<String> stationIds;
    private final Map<String, Integer> idx = new HashMap<>();
    private final double[] cum; // cumulative minutes along the whole line, by station index
    final List<String> warnings = new ArrayList<>();

    SuburbanImporter(List<Station> railStations, Path runtimes) throws IOException {
        this.stationIds = railStations.stream().map(Station::id).toList();
        for (int i = 0; i < stationIds.size(); i++) idx.put(stationIds.get(i), i);
        this.cum = new double[stationIds.size()];
        Map<String, Double> msbTbm = new HashMap<>();
        Map<String, Double> tbmCgl = new HashMap<>();
        for (Map<String, String> r : Csv.read(runtimes)) {
            Map<String, Double> target = r.get("segment").equals("MSB-TBM") ? msbTbm : tbmCgl;
            target.put(r.get("stationId"), Double.parseDouble(r.get("minutes")));
        }
        double tbmCum = msbTbm.get("TBM");
        for (int i = 0; i < cum.length; i++) {
            String id = stationIds.get(i);
            if (msbTbm.containsKey(id)) cum[i] = msbTbm.get(id);
            else if (tbmCgl.containsKey(id)) cum[i] = tbmCum + tbmCgl.get(id);
            else throw new IllegalStateException("No run-time offset for rail station " + id);
        }
        for (int i = 1; i < cum.length; i++) {
            if (cum[i] <= cum[i - 1]) throw new IllegalStateException("Run-time offsets must increase: " + stationIds.get(i));
        }
    }

    /** One published timepoint before interpolation. */
    private record Point(int station, int arrive, int depart) {}

    List<Trip> importTable(Path csv, boolean down, String set) throws IOException {
        List<Trip> trips = new ArrayList<>();
        for (Map<String, String> row : Csv.read(csv)) {
            String train = row.get("Train No.");
            try {
                trips.addAll(parseRow(row, train, down));
            } catch (RuntimeException e) {
                warnings.add(set + " train " + train + " skipped: " + e.getMessage());
            }
        }
        return trips;
    }

    private List<Trip> parseRow(Map<String, String> row, String train, boolean down) {
        List<Point> points = new ArrayList<>();
        String note = "";
        List<Trip> out = new ArrayList<>();
        Integer guindyReturn = null;
        if (down) {
            Cell msb = TimeParse.cell(row.get("MSB Dep"));
            Cell tbm = TimeParse.cell(row.get("TBM A/D"));
            String cglRaw = row.get("CGL A/D");
            Matcher gi = GI_RETURN.matcher(cglRaw);
            if (msb != null) points.add(new Point(idx.get("MSB"), msb.depart(), msb.depart()));
            if (tbm != null) points.add(new Point(idx.get("TBM"), tbm.arrive(), tbm.depart()));
            if (gi.matches()) {
                guindyReturn = TimeParse.hhmm(gi.group(1));
            } else {
                Cell cgl = TimeParse.cell(cglRaw);
                if (cgl != null) points.add(new Point(idx.get("CGL"), cgl.arrive(), cgl.depart()));
            }
            String beyond = firstNonDash(row.get("CJ A/D"), row.get("AJJ/TMLP"));
            if (!beyond.isEmpty()) note = "Continues beyond Chengalpattu (" + row.get("AJJ/TMLP").replace("—", "").strip() + ") - not drawn";
        } else {
            String cglRaw = row.get("CGL A/D");
            Matcher gi = GI_ORIGIN.matcher(cglRaw);
            if (gi.matches()) {
                int t = TimeParse.hhmm(gi.group(2));
                points.add(new Point(idx.get("GDY"), t, t));
            } else {
                Cell cgl = TimeParse.cell(cglRaw);
                if (cgl != null) points.add(new Point(idx.get("CGL"), cgl.depart(), cgl.depart()));
            }
            Cell tbm = TimeParse.cell(row.get("TBM A/D"));
            if (tbm != null) points.add(new Point(idx.get("TBM"), tbm.arrive(), tbm.depart()));
            Cell msb = TimeParse.cell(row.get("MSB Arrl"));
            if (msb != null) points.add(new Point(idx.get("MSB"), msb.arrive(), msb.arrive()));
            String start = row.get("AJJ/TMLP Dep");
            if (TimeParse.cell(start) != null) note = "Starts beyond Chengalpattu (" + start + ") - not drawn";
        }
        String dir = down ? "D" : "U";
        if (points.size() >= 2) out.add(build(train, dir, labelFor(train, down, points), note, points));
        else if (guindyReturn == null) throw new IllegalArgumentException("fewer than two timepoints");
        if (guindyReturn != null) {
            // Short working: train goes down to Tambaram, then comes back to Guindy.
            Point tbmPoint = points.get(points.size() - 1);
            if (tbmPoint.station() != idx.get("TBM")) throw new IllegalArgumentException("Guindy return without Tambaram point");
            List<Point> back = List.of(new Point(tbmPoint.station(), tbmPoint.depart(), tbmPoint.depart()),
                    new Point(idx.get("GDY"), guindyReturn, guindyReturn));
            out.add(build(train + "R", "U", train + " Tambaram to Guindy", "Short working back to Guindy", back));
        }
        return out;
    }

    private static String firstNonDash(String... cells) {
        for (String c : cells) if (c != null && !c.strip().isEmpty() && !c.strip().equals("—")) return c.strip();
        return "";
    }

    private String labelFor(String train, boolean down, List<Point> points) {
        String a = shortName(points.get(0).station());
        String b = shortName(points.get(points.size() - 1).station());
        return train + " " + a + " to " + b;
    }

    private String shortName(int stationIndex) {
        return switch (stationIds.get(stationIndex)) {
            case "MSB" -> "Beach";
            case "TBM" -> "Tambaram";
            case "CGL" -> "Chengalpattu";
            case "GDY" -> "Guindy";
            default -> stationIds.get(stationIndex);
        };
    }

    private Trip build(String id, String dir, String label, String note, List<Point> raw) {
        // Unwrap past-midnight times so the sequence never goes backwards.
        List<Point> pts = new ArrayList<>();
        int wrap = 0;
        int prev = Integer.MIN_VALUE;
        for (Point p : raw) {
            int a = p.arrive() + wrap;
            if (a < prev) { wrap += 86400; a += 86400; }
            int d = p.depart() + wrap;
            if (d < a) d += 86400 * 0; // same-cell arrival/departure already ordered by TimeParse
            pts.add(new Point(p.station(), a, d));
            prev = d;
        }
        List<Integer> s = new ArrayList<>();
        List<Integer> t = new ArrayList<>();
        for (int k = 0; k < pts.size() - 1; k++) {
            Point a = pts.get(k);
            Point b = pts.get(k + 1);
            if (k == 0) {
                s.add(a.station()); t.add(a.arrive());
                if (a.depart() != a.arrive()) { s.add(a.station()); t.add(a.depart()); }
            }
            int step = b.station() > a.station() ? 1 : -1;
            double span = cum[b.station()] - cum[a.station()];
            for (int i = a.station() + step; i != b.station(); i += step) {
                double frac = (cum[i] - cum[a.station()]) / span;
                s.add(i);
                t.add((int) Math.round(a.depart() + frac * (b.arrive() - a.depart())));
            }
            s.add(b.station()); t.add(b.arrive());
            if (b.depart() != b.arrive()) { s.add(b.station()); t.add(b.depart()); }
        }
        List<Integer> pub = pts.stream().map(Point::station).distinct().toList();
        return new Trip(id, LINE_ID, dir, label + (pub.isEmpty() ? "" : ""), note, true,
                s.stream().mapToInt(Integer::intValue).toArray(), t.stream().mapToInt(Integer::intValue).toArray());
    }

    /** Station indices that carry a published time on this trip (not estimated). */
    static int[] publishedStations(Trip trip, List<String> stationIds) {
        // Published points are those where the trip first reaches Beach, Tambaram, Chengalpattu or Guindy as an endpoint.
        List<Integer> out = new ArrayList<>();
        int n = trip.stationIdx().length;
        Map<String, Boolean> pub = Map.of("MSB", true, "TBM", true, "CGL", true);
        for (int i = 0; i < n; i++) {
            int st = trip.stationIdx()[i];
            String id = stationIds.get(st);
            boolean endpoint = i == 0 || i == n - 1;
            if ((pub.containsKey(id) || endpoint) && !out.contains(st)) out.add(st);
        }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }
}
