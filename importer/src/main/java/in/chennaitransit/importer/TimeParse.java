package in.chennaitransit.importer;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Parses the time cells found in the published suburban tables. */
final class TimeParse {
    private TimeParse() {}

    /** "07:12", "07:12/20" (arrive 07:12, depart 07:20), "23:55/59". Seconds after midnight. */
    record Cell(int arrive, int depart) {}

    private static final Pattern PLAIN = Pattern.compile("^(\\d{1,2}):(\\d{2})(?:/(\\d{2}))?$");

    static int hhmm(String s) {
        Matcher m = Pattern.compile("^(\\d{1,2}):(\\d{2})$").matcher(s.strip());
        if (!m.matches()) throw new IllegalArgumentException("Bad time: " + s);
        int h = Integer.parseInt(m.group(1));
        int min = Integer.parseInt(m.group(2));
        if (h > 29 || min > 59) throw new IllegalArgumentException("Bad time: " + s);
        return h * 3600 + min * 60;
    }

    /** Returns null for a dash, blank or non-time cell. */
    static Cell cell(String raw) {
        if (raw == null) return null;
        String s = raw.strip();
        Matcher m = PLAIN.matcher(s);
        if (!m.matches()) return null;
        int h = Integer.parseInt(m.group(1));
        int a = h * 3600 + Integer.parseInt(m.group(2)) * 60;
        int d = m.group(3) == null ? a : h * 3600 + Integer.parseInt(m.group(3)) * 60;
        if (d < a) d += 3600; // "07:55/05" style: minutes rolled into the next hour
        return new Cell(a, d);
    }
}
