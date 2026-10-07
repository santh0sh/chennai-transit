package in.chennaitransit.importer;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Minimal CSV reader: header row, quoted cells, '#' comment lines. */
final class Csv {
    private Csv() {}

    static List<Map<String, String>> read(Path file) throws IOException {
        List<String> lines = Files.readAllLines(file);
        List<Map<String, String>> rows = new ArrayList<>();
        List<String> header = null;
        for (String line : lines) {
            if (line.isBlank() || line.startsWith("#")) continue;
            List<String> cells = split(line);
            if (header == null) { header = cells; continue; }
            Map<String, String> row = new LinkedHashMap<>();
            for (int i = 0; i < header.size(); i++) {
                row.put(header.get(i), i < cells.size() ? cells.get(i).strip() : "");
            }
            rows.add(row);
        }
        return rows;
    }

    static List<String> split(String line) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (quoted) {
                if (c == '"' && i + 1 < line.length() && line.charAt(i + 1) == '"') { cur.append('"'); i++; }
                else if (c == '"') quoted = false;
                else cur.append(c);
            } else if (c == '"') quoted = true;
            else if (c == ',') { out.add(cur.toString()); cur.setLength(0); }
            else cur.append(c);
        }
        out.add(cur.toString());
        return out;
    }
}
