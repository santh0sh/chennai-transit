package in.chennaitransit.importer;

import in.chennaitransit.importer.Model.BusRoute;
import in.chennaitransit.importer.Model.Pattern;
import in.chennaitransit.importer.Model.Station;
import in.chennaitransit.importer.Model.Trip;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Checks the converted data. Errors stop the build; warnings are written into the output file. */
final class Validator {
    final List<String> errors = new ArrayList<>();
    final List<String> warnings = new ArrayList<>();

    void stations(Map<String, Station> stations) {
        for (Station s : stations.values()) {
            if (!Geo.inChennaiRegion(s.lat(), s.lon())) errors.add("Station " + s.id() + " outside the Chennai region");
            if (s.name().isBlank()) errors.add("Station " + s.id() + " has no name");
        }
    }

    void trips(String set, List<Trip> trips, int lineSize, Integer declaredPerDirection) {
        long down = trips.stream().filter(t -> t.dir().equals("D") && !t.id().endsWith("R")).count();
        long up = trips.stream().filter(t -> t.dir().equals("U") && !t.id().endsWith("R")).count();
        if (declaredPerDirection != null && (down != declaredPerDirection || up != declaredPerDirection)) {
            warnings.add(set + ": publisher states " + declaredPerDirection + " services each way; transcription has "
                    + down + " down and " + up + " up");
        }
        for (Trip t : trips) {
            if (t.stationIdx().length != t.seconds().length) errors.add(set + " " + t.id() + ": index/time length mismatch");
            for (int i = 0; i < t.seconds().length; i++) {
                if (t.stationIdx()[i] < 0 || t.stationIdx()[i] >= lineSize) errors.add(set + " " + t.id() + ": bad station index");
                if (i > 0 && t.seconds()[i] < t.seconds()[i - 1]) errors.add(set + " " + t.id() + ": time goes backwards at stop " + i);
            }
            int dur = t.seconds()[t.seconds().length - 1] - t.seconds()[0];
            if (dur <= 0 || dur > 4 * 3600) errors.add(set + " " + t.id() + ": implausible duration " + dur + "s");
        }
    }

    void patterns(String day, List<Pattern> patterns) {
        for (Pattern p : patterns) {
            if (p.departures().isEmpty()) errors.add(day + " " + p.id() + ": no departures");
            for (int i = 1; i < p.departures().size(); i++) {
                if (p.departures().get(i) <= p.departures().get(i - 1)) errors.add(day + " " + p.id() + ": departures not increasing");
            }
            int n = p.stationIds().size();
            if (p.arrOffset().length != n || p.depOffset().length != n) errors.add(day + " " + p.id() + ": offset length mismatch");
            int run = p.arrOffset()[n - 1];
            if (run < 20 * 60 || run > 90 * 60) warnings.add(day + " " + p.id() + ": estimated end-to-end run " + run / 60 + " min looks unusual");
        }
    }

    void buses(List<BusRoute> routes) {
        for (BusRoute r : routes) {
            if (r.stops().size() < 5) errors.add("Bus " + r.id() + ": too few stops");
            for (var s : r.stops()) {
                if (!Geo.inChennaiRegion(s.lat(), s.lon())) errors.add("Bus " + r.id() + " stop " + s.name() + " outside region");
            }
            if (r.headwayMin() <= 0) errors.add("Bus " + r.id() + ": bad headway");
        }
    }
}
