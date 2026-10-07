package in.chennaitransit.importer;

import java.util.List;

/** Plain data carried between the importer stages. */
final class Model {
    private Model() {}

    enum Mode { RAIL, METRO, BUS }

    record Station(String id, String name, Mode mode, double lat, double lon, String coordSource) {}

    /** A rail line: ordered station ids. */
    record Line(String id, Mode mode, String name, String color, List<String> stationIds, boolean draw) {}

    /**
     * One concrete trip. stationIdx points into the line's stationIds; times are seconds after
     * midnight (may pass 86400 for trips running past midnight). A station can appear twice
     * (arrival, then departure).
     */
    record Trip(String id, String line, String dir, String label, String note, boolean estimated,
                int[] stationIdx, int[] seconds) {}

    /** A repeating pattern used for metro: offsets from the origin departure plus departure times. */
    record Pattern(String id, String line, String dir, List<String> stationIds,
                   int[] arrOffset, int[] depOffset, List<Integer> departures, boolean estimatedRunTimes) {}

    record BusStop(String name, double lat, double lon, String coordSource) {}

    record BusRoute(String id, String origin, String destination, String color, List<BusStop> stops,
                    String mtcPageUpdated, int ordinaryFareInr, String firstDep, String lastDep,
                    int headwayMin, int speedKmh) {}

    record Source(String id, String publisher, String title, String url, String asOf, String kind, String note) {}
}
