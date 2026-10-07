package in.chennaitransit.importer;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Tiny JSON writer for maps, lists, strings, numbers, booleans and int arrays. */
final class Json {
    private Json() {}

    static Map<String, Object> obj(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    static String write(Object o, boolean pretty) {
        StringBuilder sb = new StringBuilder();
        write(sb, o, pretty ? 0 : -1);
        return sb.append('\n').toString();
    }

    private static void indent(StringBuilder sb, int level) {
        if (level < 0) return;
        sb.append('\n');
        for (int i = 0; i < level; i++) sb.append("  ");
    }

    @SuppressWarnings("unchecked")
    private static void write(StringBuilder sb, Object o, int level) {
        int next = level < 0 ? -1 : level + 1;
        switch (o) {
            case null -> sb.append("null");
            case String s -> str(sb, s);
            case Boolean b -> sb.append(b);
            case Integer i -> sb.append(i);
            case Long l -> sb.append(l);
            case Double d -> sb.append(num(d));
            case Float f -> sb.append(num(f));
            case int[] a -> {
                sb.append('[');
                for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(','); sb.append(a[i]); }
                sb.append(']');
            }
            case Map<?, ?> m -> {
                sb.append('{');
                boolean first = true;
                for (Map.Entry<String, Object> e : ((Map<String, Object>) m).entrySet()) {
                    if (!first) sb.append(',');
                    first = false;
                    indent(sb, next);
                    str(sb, e.getKey());
                    sb.append(level < 0 ? ":" : ": ");
                    write(sb, e.getValue(), next);
                }
                if (!m.isEmpty()) indent(sb, level);
                sb.append('}');
            }
            case List<?> l -> {
                sb.append('[');
                boolean first = true;
                boolean flat = l.stream().allMatch(x -> x == null || x instanceof Number || x instanceof String);
                for (Object x : l) {
                    if (!first) sb.append(',');
                    first = false;
                    if (!flat) indent(sb, next);
                    write(sb, x, flat ? -1 : next);
                }
                if (!l.isEmpty() && !flat) indent(sb, level);
                sb.append(']');
            }
            default -> throw new IllegalArgumentException("Unsupported JSON value: " + o.getClass());
        }
    }

    private static String num(double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) throw new IllegalArgumentException("non-finite number");
        if (d == Math.rint(d) && Math.abs(d) < 1e15) return Long.toString((long) d);
        return Double.toString(Math.round(d * 1e6) / 1e6);
    }

    private static void str(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
                }
            }
        }
        sb.append('"');
    }
}
