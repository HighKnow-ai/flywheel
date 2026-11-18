//! The one place that writes, reads and compares the RFC 3339 timestamps this workspace stores.
//!
//! Every `*_at` column, the heartbeat file, the kill record and the shim's contention record hold
//! text written by [`now_rfc3339`]. The text is part of the on-disk contract, so this module keeps
//! the exact shape that `chrono`'s `Utc::now().to_rfc3339()` wrote before issue #1728 moved the
//! workspace to `jiff`: `YYYY-MM-DDTHH:MM:SS`, then a fraction of 3, 6 or 9 digits (or none when
//! the instant falls on a whole second), then `+00:00`. Two properties depend on it:
//!
//! - The offset is the literal `+00:00`, never `Z`. Several queries compare the strings directly
//!   (`ORDER BY created_at`, `started_at <= ?`), and a column that mixed `Z` and `+00:00` would
//!   sort wrongly inside one second.
//! - The fraction has a fixed width per instant, as `chrono` wrote it. `jiff`'s own `Display`
//!   trims trailing zeros one digit at a time and ends with `Z`, so it is NOT used for writing.
//!
//! Reading is more tolerant than writing, on purpose: a value written by an older build, or by
//! `git log --format=%cI` (`...+08:00`), parses to the same instant whatever its spelling.

use std::time::Duration;

use jiff::tz::TimeZone;
use jiff::Timestamp;

/// The current time as the RFC 3339 text every timestamp column holds.
pub fn now_rfc3339() -> String {
    format_rfc3339(Timestamp::now())
}

/// `instant` in the stored spelling: UTC, `+00:00`, and a fraction of 3, 6 or 9 digits only when
/// the instant is not on a whole second (the shortest of those that loses nothing).
pub fn format_rfc3339(instant: Timestamp) -> String {
    let utc = TimeZone::UTC.to_datetime(instant);
    let nanos = utc.subsec_nanosecond();
    let fraction = if nanos == 0 {
        String::new()
    } else if nanos % 1_000_000 == 0 {
        format!(".{:03}", nanos / 1_000_000)
    } else if nanos % 1_000 == 0 {
        format!(".{:06}", nanos / 1_000)
    } else {
        format!(".{nanos:09}")
    };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}{fraction}+00:00",
        utc.year(),
        utc.month(),
        utc.day(),
        utc.hour(),
        utc.minute(),
        utc.second(),
    )
}

/// The instant an RFC 3339 string names, whatever its offset (`Z`, `+00:00` and `+08:00` all
/// parse), or `None` when it is not one. A string with no offset is not one: it names no instant.
pub fn parse_rfc3339(text: &str) -> Option<Timestamp> {
    text.parse().ok()
}

/// How long ago `earlier` was, as seen from `now`, or `None` when `earlier` is in the future.
pub fn elapsed_between(earlier: Timestamp, now: Timestamp) -> Option<Duration> {
    Duration::try_from(now.duration_since(earlier)).ok()
}

#[cfg(test)]
mod tests {
    use jiff::SignedDuration;

    use super::*;

    fn at(second: i64, nanos: i32) -> Timestamp {
        Timestamp::new(second, nanos).expect("in range")
    }

    #[test]
    fn a_whole_second_has_no_fraction() {
        assert_eq!(
            format_rfc3339(at(1_700_000_000, 0)),
            "2023-11-14T22:13:20+00:00"
        );
    }

    #[test]
    fn the_fraction_is_three_six_or_nine_digits_never_trimmed_one_at_a_time() {
        let whole = 1_700_000_000;
        assert_eq!(
            format_rfc3339(at(whole, 120_000_000)),
            "2023-11-14T22:13:20.120+00:00"
        );
        assert_eq!(
            format_rfc3339(at(whole, 123_450_000)),
            "2023-11-14T22:13:20.123450+00:00"
        );
        assert_eq!(
            format_rfc3339(at(whole, 123_456_700)),
            "2023-11-14T22:13:20.123456700+00:00"
        );
        assert_eq!(
            format_rfc3339(at(whole, 1)),
            "2023-11-14T22:13:20.000000001+00:00"
        );
        assert_eq!(
            format_rfc3339(at(whole, 1_000)),
            "2023-11-14T22:13:20.000001+00:00"
        );
    }

    #[test]
    fn the_epoch_and_the_far_ends_keep_four_digit_years() {
        assert_eq!(format_rfc3339(at(0, 0)), "1970-01-01T00:00:00+00:00");
        assert_eq!(
            format_rfc3339(Timestamp::MAX),
            "9999-12-30T22:00:00.999999999+00:00"
        );
    }

    #[test]
    fn now_has_the_stored_shape_and_parses_back_to_the_same_instant() {
        let text = now_rfc3339();
        let shape = text.len() == "2026-11-17T10:20:30+00:00".len()
            || [3, 6, 9]
                .iter()
                .any(|digits| text.len() == "2026-11-17T10:20:30+00:00".len() + 1 + digits);
        assert!(shape, "{text}");
        assert!(text.ends_with("+00:00"), "{text}");
        let parsed = parse_rfc3339(&text).expect("what it writes it reads");
        assert_eq!(format_rfc3339(parsed), text);
    }

    #[test]
    fn a_row_written_in_the_old_format_reads_to_the_instant_it_names() {
        // What `chrono::Utc::now().to_rfc3339()` wrote, at each of its three fraction widths.
        let expected = at(1_700_000_000, 0);
        assert_eq!(parse_rfc3339("2023-11-14T22:13:20+00:00"), Some(expected));
        assert_eq!(
            parse_rfc3339("2023-11-14T22:13:20.123+00:00"),
            Some(at(1_700_000_000, 123_000_000))
        );
        assert_eq!(
            parse_rfc3339("2023-11-14T22:13:20.123456+00:00"),
            Some(at(1_700_000_000, 123_456_000))
        );
        assert_eq!(
            parse_rfc3339("2023-11-14T22:13:20.123456789+00:00"),
            Some(at(1_700_000_000, 123_456_789))
        );
    }

    #[test]
    fn other_spellings_of_one_instant_compare_equal() {
        // `git log --format=%cI` writes the committer's own offset; some tools write `Z`.
        let utc = parse_rfc3339("2026-10-19T10:00:00+00:00").unwrap();
        assert_eq!(parse_rfc3339("2026-10-19T10:00:00Z"), Some(utc));
        assert_eq!(parse_rfc3339("2026-10-19T18:00:00+08:00"), Some(utc));
        assert_eq!(parse_rfc3339("2026-10-19T05:30:00-04:30"), Some(utc));
    }

    #[test]
    fn text_that_names_no_instant_is_none() {
        for text in [
            "",
            "not a time",
            "2026-10-19",
            "2026-10-19T10:00:00",
            "2026-13-19T10:00:00+00:00",
            "2026-10-19T25:00:00+00:00",
        ] {
            assert_eq!(parse_rfc3339(text), None, "{text:?}");
        }
    }

    #[test]
    fn elapsed_between_is_none_for_an_instant_in_the_future() {
        let now = at(1_700_000_000, 0);
        assert_eq!(
            elapsed_between(now - SignedDuration::from_secs(5), now),
            Some(Duration::from_secs(5))
        );
        assert_eq!(elapsed_between(now, now), Some(Duration::ZERO));
        assert_eq!(
            elapsed_between(now + SignedDuration::from_secs(1), now),
            None
        );
    }
}
