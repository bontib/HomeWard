//! Comparing version strings the way people write them: "10.2", "6.0.1", "1.0.0-beta2",
//! "1.1.1k", "2023.04.01". A version we cannot read gives `None` (the component becomes
//! `BAD_VERSION`), never a guess.
//!
//! A version is a list of numbers ("release") plus an optional tail ("suffix").
//! A tail that starts with a pre-release word (alpha, beta, rc ...) sorts before the plain
//! release; any other tail ("k", "sp1", "update2") sorts after it.

use std::cmp::Ordering;

/// "1.0b2" means beta 2, but "1.1.1k" is a patch letter. A lone letter only counts as
/// pre-release when a number follows it.
const SHORT_PRE_RELEASE_LETTERS: &[(&str, u8)] = &[("a", 1), ("b", 2), ("m", 3)];

const PRE_RELEASE_WORDS: &[(&str, u8)] = &[
    ("dev", 0),
    ("alpha", 1),
    ("beta", 2),
    ("milestone", 3),
    ("pre", 4),
    ("preview", 4),
    ("rc", 5),
    ("cr", 5),
    ("candidate", 5),
];

#[derive(Debug, Clone, PartialEq, Eq)]
enum Token {
    Number(u64),
    /// A pre-release word with its rank (alpha < beta < rc).
    Pre(u8),
    Word(String),
}

impl Token {
    fn rank(&self) -> u8 {
        match self {
            Self::Number(_) => 0,
            Self::Pre(_) => 1,
            Self::Word(_) => 2,
        }
    }
}

impl Ord for Token {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (Self::Number(a), Self::Number(b)) => a.cmp(b),
            (Self::Pre(a), Self::Pre(b)) => a.cmp(b),
            (Self::Word(a), Self::Word(b)) => a.cmp(b),
            _ => self.rank().cmp(&other.rank()),
        }
    }
}

impl PartialOrd for Token {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    release: Vec<u64>,
    suffix: Vec<Token>,
}

impl Version {
    /// Reads a version. Returns `None` when it does not start with a number
    /// ("unknown", "beta build xyz") or contains characters we do not understand.
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        let text = text.strip_prefix(['v', 'V']).unwrap_or(text);
        // "1.2.3+build5": build metadata never changes the order.
        let text = text.split('+').next().unwrap_or(text);
        if !text.starts_with(|c: char| c.is_ascii_digit()) {
            return None;
        }
        let tokens = tokenize(text)?;
        let split = tokens
            .iter()
            .position(|t| !matches!(t, Raw::Number(_)))
            .unwrap_or(tokens.len());
        let release = tokens[..split]
            .iter()
            .map(|t| match t {
                Raw::Number(n) => *n,
                Raw::Word(_) => 0,
            })
            .collect();
        let tail = &tokens[split..];
        let suffix = tail
            .iter()
            .enumerate()
            .map(|(i, raw)| to_token(raw, matches!(tail.get(i + 1), Some(Raw::Number(_)))))
            .collect();
        Some(Self { release, suffix })
    }

    /// 0 for a plain release, below 0 for pre-releases, above 0 for "1.1.1k"-style tails.
    fn suffix_kind(&self) -> i8 {
        match self.suffix.first() {
            None => 0,
            Some(Token::Pre(_)) => -1,
            Some(_) => 1,
        }
    }
}

enum Raw {
    Number(u64),
    Word(String),
}

fn to_token(raw: &Raw, number_follows: bool) -> Token {
    match raw {
        Raw::Number(n) => Token::Number(*n),
        Raw::Word(w) => {
            let short = SHORT_PRE_RELEASE_LETTERS.iter().filter(|_| number_follows);
            PRE_RELEASE_WORDS
                .iter()
                .chain(short)
                .find(|(name, _)| name == w)
                .map_or_else(|| Token::Word(w.clone()), |(_, rank)| Token::Pre(*rank))
        }
    }
}

/// Splits into runs of digits and runs of letters. `.`, `-`, `_` and spaces only separate.
fn tokenize(text: &str) -> Option<Vec<Raw>> {
    let mut tokens = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            let mut digits = String::new();
            while let Some(&d) = chars.peek().filter(|d| d.is_ascii_digit()) {
                digits.push(d);
                chars.next();
            }
            tokens.push(Raw::Number(digits.parse().ok()?));
        } else if c.is_ascii_alphabetic() {
            let mut word = String::new();
            while let Some(&w) = chars.peek().filter(|w| w.is_ascii_alphabetic()) {
                word.push(w.to_ascii_lowercase());
                chars.next();
            }
            tokens.push(Raw::Word(word));
        } else if matches!(c, '.' | '-' | '_' | ' ') {
            chars.next();
        } else {
            return None;
        }
    }
    Some(tokens)
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        let len = self.release.len().max(other.release.len());
        for i in 0..len {
            let a = self.release.get(i).copied().unwrap_or(0);
            let b = other.release.get(i).copied().unwrap_or(0);
            if a != b {
                return a.cmp(&b);
            }
        }
        self.suffix_kind()
            .cmp(&other.suffix_kind())
            .then_with(|| self.suffix.cmp(&other.suffix))
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// One side of a range such as NVD's `versionStartIncluding`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bound {
    pub version: Version,
    pub inclusive: bool,
}

/// A version range. A missing side is open.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Range {
    pub start: Option<Bound>,
    pub end: Option<Bound>,
}

impl Range {
    pub fn contains(&self, version: &Version) -> bool {
        let after_start = self
            .start
            .as_ref()
            .is_none_or(|b| match version.cmp(&b.version) {
                Ordering::Greater => true,
                Ordering::Equal => b.inclusive,
                Ordering::Less => false,
            });
        let before_end = self
            .end
            .as_ref()
            .is_none_or(|b| match version.cmp(&b.version) {
                Ordering::Less => true,
                Ordering::Equal => b.inclusive,
                Ordering::Greater => false,
            });
        after_start && before_end
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(text: &str) -> Version {
        Version::parse(text).unwrap_or_else(|| panic!("{text:?} should parse"))
    }

    fn less(a: &str, b: &str) {
        assert!(v(a) < v(b), "{a} should be older than {b}");
        assert!(v(b) > v(a), "{b} should be newer than {a}");
    }

    fn same(a: &str, b: &str) {
        assert_eq!(v(a).cmp(&v(b)), Ordering::Equal, "{a} should equal {b}");
    }

    #[test]
    fn numbers_compare_as_numbers_not_text() {
        less("2.9", "2.10");
        less("9", "10");
        less("1.2.3", "1.2.10");
    }

    #[test]
    fn missing_trailing_zeros_do_not_matter() {
        same("1.0", "1.0.0");
        same("10", "10.0.0.0");
        less("1.0", "1.0.1");
    }

    #[test]
    fn long_windows_style_versions_compare() {
        less("10.0.19041.1", "10.0.19041.2");
        less("10.0.19041.9999", "10.0.19042.1");
    }

    #[test]
    fn leading_v_and_whitespace_are_ignored() {
        same("v1.2.3", "1.2.3");
        same("  V2.0 ", "2.0");
    }

    #[test]
    fn build_metadata_is_ignored() {
        same("1.2.3+build7", "1.2.3");
    }

    #[test]
    fn pre_releases_come_before_the_release() {
        less("1.0.0-beta", "1.0.0");
        less("2.0rc1", "2.0");
        less("1.0-alpha", "1.0-beta");
        less("1.0-beta", "1.0-rc");
    }

    #[test]
    fn pre_release_numbers_compare() {
        less("1.0-beta2", "1.0-beta10");
        less("1.0-rc1", "1.0-rc2");
        same("1.0.0-beta.2", "1.0.0-beta2");
    }

    #[test]
    fn pre_release_is_still_newer_than_the_previous_release() {
        less("0.9.9", "1.0-alpha");
    }

    #[test]
    fn letter_suffix_comes_after_the_release() {
        less("1.1.1", "1.1.1a");
        less("1.1.1a", "1.1.1k");
        less("1.1.1k", "1.1.2");
    }

    #[test]
    fn short_pre_release_letters_need_a_number() {
        less("1.0b2", "1.0");
        less("1.0a1", "1.0b1");
    }

    #[test]
    fn service_packs_come_after_the_release() {
        less("6.1", "6.1 sp1");
        less("6.1 sp1", "6.1 sp2");
        less("6.1 sp2", "6.2");
    }

    #[test]
    fn dates_work_as_versions() {
        less("2023-04-01", "2023-10-02");
        less("2023.04.01", "2023.04.15");
    }

    #[test]
    fn text_without_a_leading_number_is_not_a_version() {
        for bad in [
            "",
            "   ",
            "unknown",
            "beta build xyz",
            "latest",
            "x.y",
            "Windows 10",
        ] {
            assert!(Version::parse(bad).is_none(), "{bad:?} must not parse");
        }
    }

    #[test]
    fn odd_characters_are_not_a_version() {
        for bad in ["1.2:3", "1.2/3", "1.2.3!", "1,5"] {
            assert!(Version::parse(bad).is_none(), "{bad:?} must not parse");
        }
    }

    #[test]
    fn numbers_too_big_for_u64_are_not_a_version() {
        assert!(Version::parse("99999999999999999999999").is_none());
    }

    fn range(start: Option<(&str, bool)>, end: Option<(&str, bool)>) -> Range {
        let bound = |(text, inclusive): (&str, bool)| Bound {
            version: v(text),
            inclusive,
        };
        Range {
            start: start.map(bound),
            end: end.map(bound),
        }
    }

    #[test]
    fn range_end_excluding_leaves_out_the_fixed_version() {
        let r = range(None, Some(("10.2", false)));
        assert!(r.contains(&v("10.1.9")));
        assert!(!r.contains(&v("10.2")));
        assert!(!r.contains(&v("10.3")));
    }

    #[test]
    fn range_end_including_contains_the_end() {
        let r = range(None, Some(("10.2", true)));
        assert!(r.contains(&v("10.2")));
        assert!(!r.contains(&v("10.2.1")));
    }

    #[test]
    fn range_start_including_and_excluding() {
        let including = range(Some(("2.0", true)), None);
        let excluding = range(Some(("2.0", false)), None);
        assert!(including.contains(&v("2.0")));
        assert!(!excluding.contains(&v("2.0")));
        assert!(excluding.contains(&v("2.0.1")));
        assert!(!including.contains(&v("1.9")));
    }

    #[test]
    fn open_range_contains_everything() {
        assert!(Range::default().contains(&v("0.0.1")));
    }

    #[test]
    fn range_with_both_sides() {
        let r = range(Some(("5.0", true)), Some(("5.4.2", false)));
        assert!(r.contains(&v("5.0")));
        assert!(r.contains(&v("5.4.1")));
        assert!(!r.contains(&v("5.4.2")));
        assert!(!r.contains(&v("4.9")));
    }

    #[test]
    fn pre_release_of_the_fixed_version_is_still_affected() {
        let r = range(None, Some(("2.0", false)));
        assert!(r.contains(&v("2.0-rc1")));
    }
}
