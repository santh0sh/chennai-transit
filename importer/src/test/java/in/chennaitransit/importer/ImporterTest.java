package in.chennaitransit.importer;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class ImporterTest {
    @Test void parsesPlainAndSplitTimes() {
        assertEquals(7 * 3600 + 12 * 60, TimeParse.cell("07:12").arrive());
        var c = TimeParse.cell("07:12/20");
        assertEquals(7 * 3600 + 12 * 60, c.arrive());
        assertEquals(7 * 3600 + 20 * 60, c.depart());
        assertNull(TimeParse.cell("—"));
    }

    @Test void metroHeadwayFollowsBands() {
        var bands = List.of(new MetroImporter.Band(5 * 3600, 8 * 3600, 7), new MetroImporter.Band(8 * 3600, 11 * 3600, 6));
        assertEquals(7, MetroImporter.headwayAt(bands, 6 * 3600));
        assertEquals(6, MetroImporter.headwayAt(bands, 9 * 3600));
        assertEquals(6, MetroImporter.headwayAt(bands, 23 * 3600));
    }

    @Test void csvHandlesQuotedCommas() {
        assertEquals(List.of("a", "b, c", "d"), Csv.split("a,\"b, c\",d"));
    }

    @Test void jsonEscapesStrings() {
        assertEquals("{\"k\":\"a\\\"b\"}\n", Json.write(Json.obj("k", "a\"b"), false));
    }
}
