package in.chennaitransit.importer;

/** Small geographic helpers. */
final class Geo {
    private Geo() {}

    static double haversineKm(double lat1, double lon1, double lat2, double lon2) {
        double r = 6371.0088;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * r * Math.asin(Math.sqrt(a));
    }

    static boolean inChennaiRegion(double lat, double lon) {
        return lat >= 12.60 && lat <= 13.30 && lon >= 79.90 && lon <= 80.40;
    }
}
