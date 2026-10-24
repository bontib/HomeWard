//! CPE 2.3 names and matching a product version against NVD `configurations`.
//!
//! Known limit: NVD can say "vulnerable only when running on platform X" (AND nodes with
//! `vulnerable: false` entries). We look only at the entries marked `vulnerable: true` for our
//! product, so a CVE may be shown for a platform the device does not run. We prefer showing
//! a possible problem over hiding a real one.

use serde_json::Value;
use thiserror::Error;

use crate::version::{Bound, Range, Version};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CpeError {
    #[error("not a CPE 2.3 name: {0}")]
    NotCpe23(String),
}

/// A parsed `cpe:2.3:part:vendor:product:version:update:...` name. Fields stay as written
/// (with their `\` escapes) so a base name can be compared and printed unchanged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cpe {
    pub part: String,
    pub vendor: String,
    pub product: String,
    pub version: String,
    pub update: String,
}

impl Cpe {
    pub fn parse(name: &str) -> Result<Self, CpeError> {
        let fields = split_unescaped(name);
        let bad = || CpeError::NotCpe23(name.to_string());
        if fields.len() < 5 || fields[0] != "cpe" || fields[1] != "2.3" {
            return Err(bad());
        }
        if !matches!(fields[2].as_str(), "a" | "o" | "h")
            || fields[3].is_empty()
            || fields[4].is_empty()
        {
            return Err(bad());
        }
        let get = |i: usize| fields.get(i).cloned().unwrap_or_else(|| "*".to_string());
        Ok(Self {
            part: fields[2].clone(),
            vendor: fields[3].clone(),
            product: fields[4].clone(),
            version: get(5),
            update: get(6),
        })
    }

    /// `cpe:2.3:o:vendor:product`, the name we store per product and match on.
    pub fn base(&self) -> String {
        format!("cpe:2.3:{}:{}:{}", self.part, self.vendor, self.product)
    }

    /// True for a name that pins one version ("10.0.1"), false for "*" (any) and "-" (none).
    fn has_exact_version(&self) -> bool {
        !matches!(self.version.as_str(), "*" | "-" | "")
    }
}

/// Splits on `:` but not on `\:`.
fn split_unescaped(name: &str) -> Vec<String> {
    let mut fields = vec![String::new()];
    let mut escaped = false;
    for c in name.chars() {
        match (escaped, c) {
            (false, '\\') => {
                escaped = true;
                push_char(&mut fields, c);
            }
            (false, ':') => fields.push(String::new()),
            _ => {
                escaped = false;
                push_char(&mut fields, c);
            }
        }
    }
    fields
}

fn push_char(fields: &mut [String], c: char) {
    if let Some(last) = fields.last_mut() {
        last.push(c);
    }
}

/// Removes CPE escapes: `10\.0` becomes `10.0`.
pub fn unescape(field: &str) -> String {
    let mut out = String::with_capacity(field.len());
    let mut escaped = false;
    for c in field.chars() {
        if c == '\\' && !escaped {
            escaped = true;
        } else {
            escaped = false;
            out.push(c);
        }
    }
    out
}

/// What we know once a version falls inside a vulnerable range.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Affected {
    /// `versionEndExcluding` of the range that matched: the first version without the problem.
    pub fixed_version: Option<String>,
}

/// Checks `version` against the vulnerable entries of one CVE for the product `base_cpe`.
/// Returns `None` when the version is not affected.
pub fn match_configurations(
    configurations: &Value,
    base_cpe: &str,
    version: &Version,
) -> Option<Affected> {
    let mut affected: Vec<Affected> = Vec::new();
    for entry in vulnerable_entries(configurations) {
        let Ok(criteria) = Cpe::parse(entry.get("criteria").and_then(Value::as_str).unwrap_or(""))
        else {
            continue;
        };
        if !criteria.base().eq_ignore_ascii_case(base_cpe) {
            continue;
        }
        if let Some(found) = match_entry(entry, &criteria, version) {
            affected.push(found);
        }
    }
    pick_nearest_fix(affected)
}

fn vulnerable_entries(configurations: &Value) -> impl Iterator<Item = &Value> {
    configurations
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|config| config.get("nodes").and_then(Value::as_array))
        .flatten()
        .filter_map(|node| node.get("cpeMatch").and_then(Value::as_array))
        .flatten()
        .filter(|entry| entry.get("vulnerable").and_then(Value::as_bool) == Some(true))
}

fn match_entry(entry: &Value, criteria: &Cpe, version: &Version) -> Option<Affected> {
    if criteria.has_exact_version() {
        return match_exact(criteria, version);
    }
    if criteria.version == "-" {
        return None;
    }
    let range = range_of(entry)?;
    range.contains(version).then(|| Affected {
        fixed_version: text_of(entry, "versionEndExcluding"),
    })
}

fn match_exact(criteria: &Cpe, version: &Version) -> Option<Affected> {
    let mut text = unescape(&criteria.version);
    if !matches!(criteria.update.as_str(), "*" | "-" | "") {
        text = format!("{text} {}", unescape(&criteria.update));
    }
    let pinned = Version::parse(&text)?;
    (pinned == *version).then_some(Affected {
        fixed_version: None,
    })
}

fn text_of(entry: &Value, key: &str) -> Option<String> {
    entry.get(key).and_then(Value::as_str).map(str::to_string)
}

/// Builds the range. `None` when a bound is present but unreadable: we cannot tell
/// whether the version is inside, and saying "not affected" would be a guess.
fn range_of(entry: &Value) -> Option<Range> {
    let bound = |key: &str, inclusive: bool| -> Result<Option<Bound>, ()> {
        match text_of(entry, key) {
            None => Ok(None),
            Some(text) => Version::parse(&text)
                .map(|version| Some(Bound { version, inclusive }))
                .ok_or(()),
        }
    };
    let start = bound("versionStartIncluding", true)
        .and_then(|inc| bound("versionStartExcluding", false).map(|exc| inc.or(exc)))
        .ok()?;
    let end = bound("versionEndIncluding", true)
        .and_then(|inc| bound("versionEndExcluding", false).map(|exc| inc.or(exc)))
        .ok()?;
    Some(Range { start, end })
}

/// When several ranges match, the lowest fix is the one the user reaches first.
fn pick_nearest_fix(affected: Vec<Affected>) -> Option<Affected> {
    let mut best: Option<(Option<Version>, Affected)> = None;
    for item in affected {
        let parsed = item.fixed_version.as_deref().and_then(Version::parse);
        let better = match (&best, &parsed) {
            (None, _) => true,
            (Some((None, _)), Some(_)) => true,
            (Some((Some(current), _)), Some(candidate)) => candidate < current,
            _ => false,
        };
        if better {
            best = Some((parsed, item));
        }
    }
    best.map(|(_, item)| item)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const BASE: &str = "cpe:2.3:o:microsoft:xbox_one_firmware";

    fn v(text: &str) -> Version {
        Version::parse(text).unwrap_or_else(|| panic!("{text} should parse"))
    }

    fn configs(matches: Value) -> Value {
        json!([{ "nodes": [{ "operator": "OR", "cpeMatch": matches }] }])
    }

    #[test]
    fn parse_reads_the_main_fields() {
        let cpe = Cpe::parse("cpe:2.3:o:microsoft:xbox_one_firmware:10.0:sp1:*:*:*:*:*:*").unwrap();
        assert_eq!(cpe.part, "o");
        assert_eq!(cpe.vendor, "microsoft");
        assert_eq!(cpe.product, "xbox_one_firmware");
        assert_eq!(cpe.version, "10.0");
        assert_eq!(cpe.update, "sp1");
    }

    #[test]
    fn base_drops_version_and_the_rest() {
        let cpe = Cpe::parse("cpe:2.3:a:vlc:vlc_media_player:3.0.1:*:*:*:*:*:*:*").unwrap();
        assert_eq!(cpe.base(), "cpe:2.3:a:vlc:vlc_media_player");
    }

    #[test]
    fn escaped_colons_stay_inside_a_field() {
        let cpe = Cpe::parse(r"cpe:2.3:a:some\:vendor:tool:1.0:*:*:*:*:*:*:*").unwrap();
        assert_eq!(cpe.vendor, r"some\:vendor");
        assert_eq!(cpe.product, "tool");
        assert_eq!(cpe.version, "1.0");
    }

    #[test]
    fn short_names_fill_missing_fields_with_a_wildcard() {
        let cpe = Cpe::parse("cpe:2.3:h:acme:router").unwrap();
        assert_eq!(cpe.version, "*");
    }

    #[test]
    fn names_that_are_not_cpe_23_are_refused() {
        for bad in [
            "",
            "cpe:/o:microsoft:windows",
            "cpe:2.3:x:a:b",
            "cpe:2.3:a::b",
            "hello",
        ] {
            assert!(Cpe::parse(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn unescape_removes_backslashes() {
        assert_eq!(unescape(r"10\.0\-beta"), "10.0-beta");
        assert_eq!(unescape(r"a\\b"), r"a\b");
    }

    #[test]
    fn end_excluding_matches_below_and_gives_the_fix() {
        let c = configs(json!([{
            "vulnerable": true,
            "criteria": "cpe:2.3:o:microsoft:xbox_one_firmware:*:*:*:*:*:*:*:*",
            "versionEndExcluding": "10.0.19041.1500"
        }]));
        let hit = match_configurations(&c, BASE, &v("10.0.19041.1000")).unwrap();
        assert_eq!(hit.fixed_version.as_deref(), Some("10.0.19041.1500"));
        assert!(match_configurations(&c, BASE, &v("10.0.19041.1500")).is_none());
    }

    #[test]
    fn end_including_matches_but_has_no_known_fix() {
        let c = configs(json!([{
            "vulnerable": true,
            "criteria": "cpe:2.3:o:microsoft:xbox_one_firmware:*:*:*:*:*:*:*:*",
            "versionStartIncluding": "9.0",
            "versionEndIncluding": "9.9"
        }]));
        assert_eq!(
            match_configurations(&c, BASE, &v("9.9")),
            Some(Affected {
                fixed_version: None
            })
        );
        assert!(match_configurations(&c, BASE, &v("9.10")).is_none());
        assert!(match_configurations(&c, BASE, &v("8.9")).is_none());
    }

    #[test]
    fn exact_version_criteria_match_only_that_version() {
        let c = configs(json!([{
            "vulnerable": true,
            "criteria": "cpe:2.3:o:microsoft:xbox_one_firmware:10.0.1:*:*:*:*:*:*:*"
        }]));
        assert!(match_configurations(&c, BASE, &v("10.0.1")).is_some());
        assert!(match_configurations(&c, BASE, &v("10.0.2")).is_none());
    }

    #[test]
    fn exact_version_with_update_needs_both() {
        let c = configs(json!([{
            "vulnerable": true,
            "criteria": "cpe:2.3:o:microsoft:xbox_one_firmware:2.0:beta1:*:*:*:*:*:*"
        }]));
        assert!(match_configurations(&c, BASE, &v("2.0 beta1")).is_some());
        assert!(match_configurations(&c, BASE, &v("2.0")).is_none());
    }

    #[test]
    fn wildcard_without_bounds_means_every_version() {
        let c = configs(json!([{
            "vulnerable": true,
            "criteria": "cpe:2.3:o:microsoft:xbox_one_firmware:*:*:*:*:*:*:*:*"
        }]));
        assert!(match_configurations(&c, BASE, &v("1.0")).is_some());
    }

    #[test]
    fn dash_version_matches_no_version_number() {
        let c = configs(json!([{
            "vulnerable": true,
            "criteria": "cpe:2.3:o:microsoft:xbox_one_firmware:-:*:*:*:*:*:*:*"
        }]));
        assert!(match_configurations(&c, BASE, &v("1.0")).is_none());
    }

    #[test]
    fn other_products_are_ignored() {
        let c = configs(json!([{
            "vulnerable": true,
            "criteria": "cpe:2.3:o:microsoft:windows_10:*:*:*:*:*:*:*:*"
        }]));
        assert!(match_configurations(&c, BASE, &v("1.0")).is_none());
    }

    #[test]
    fn platform_entries_that_are_not_vulnerable_are_ignored() {
        let c = configs(json!([{
            "vulnerable": false,
            "criteria": "cpe:2.3:o:microsoft:xbox_one_firmware:*:*:*:*:*:*:*:*"
        }]));
        assert!(match_configurations(&c, BASE, &v("1.0")).is_none());
    }

    #[test]
    fn product_names_match_without_regard_to_case() {
        let c = configs(json!([{
            "vulnerable": true,
            "criteria": "cpe:2.3:o:Microsoft:Xbox_One_Firmware:*:*:*:*:*:*:*:*"
        }]));
        assert!(match_configurations(&c, BASE, &v("1.0")).is_some());
    }

    #[test]
    fn an_unreadable_bound_does_not_claim_the_version_is_safe_or_affected() {
        let c = configs(json!([{
            "vulnerable": true,
            "criteria": "cpe:2.3:o:microsoft:xbox_one_firmware:*:*:*:*:*:*:*:*",
            "versionEndExcluding": "next-gen"
        }]));
        assert!(match_configurations(&c, BASE, &v("1.0")).is_none());
    }

    #[test]
    fn the_lowest_fix_wins_when_two_ranges_match() {
        let c = configs(json!([
            { "vulnerable": true, "criteria": "cpe:2.3:o:microsoft:xbox_one_firmware:*:*:*:*:*:*:*:*", "versionEndExcluding": "12.0" },
            { "vulnerable": true, "criteria": "cpe:2.3:o:microsoft:xbox_one_firmware:*:*:*:*:*:*:*:*", "versionEndExcluding": "10.5" }
        ]));
        let hit = match_configurations(&c, BASE, &v("10.0")).unwrap();
        assert_eq!(hit.fixed_version.as_deref(), Some("10.5"));
    }

    #[test]
    fn missing_or_odd_configurations_match_nothing() {
        assert!(match_configurations(&Value::Null, BASE, &v("1.0")).is_none());
        assert!(match_configurations(&json!({"nodes": 3}), BASE, &v("1.0")).is_none());
        assert!(match_configurations(&json!([]), BASE, &v("1.0")).is_none());
    }

    #[test]
    fn real_nvd_fixture_is_matched() {
        let page: Value =
            serde_json::from_str(include_str!("../tests/fixtures/nvd/cves_xbox.json")).unwrap();
        let first = &page["vulnerabilities"][0]["cve"]["configurations"];
        let hit = match_configurations(first, BASE, &v("10.0.19041.1000")).unwrap();
        assert_eq!(hit.fixed_version.as_deref(), Some("10.0.19041.1500"));
    }
}
