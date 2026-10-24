//! Reads CycloneDX and SPDX JSON into a flat component list.
//!
//! Safety: the file comes from a user. We only parse JSON (serde_json stops at a nesting
//! depth of 128), never follow paths or URLs inside it, and cap the size and the number of
//! components. The file name the user gave is never used here.

use std::collections::HashSet;

use serde_json::Value;
use thiserror::Error;

use crate::contract::SbomFormat;
use crate::error::JobError;

/// Hard stop in the worker, whatever `MAX_SBOM_MB` says in the web app.
pub const MAX_SBOM_BYTES: usize = 100 * 1024 * 1024;
pub const MAX_COMPONENTS: usize = 20_000;
const MAX_FIELD_CHARS: usize = 255;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SbomError {
    #[error("the file is larger than {} MB", MAX_SBOM_BYTES / 1024 / 1024)]
    TooLarge,
    #[error("the file is not valid JSON: {0}")]
    NotJson(String),
    #[error("the JSON is not a {0} document")]
    WrongFormat(&'static str),
    #[error("the file lists more than {MAX_COMPONENTS} components")]
    TooManyComponents,
}

impl From<SbomError> for JobError {
    fn from(err: SbomError) -> Self {
        Self::SbomInvalid(err.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SbomComponent {
    pub name: String,
    pub version: Option<String>,
    pub vendor: Option<String>,
    pub purl: Option<String>,
    pub cpe: Option<String>,
}

pub fn parse(format: SbomFormat, bytes: &[u8]) -> Result<Vec<SbomComponent>, SbomError> {
    if bytes.len() > MAX_SBOM_BYTES {
        return Err(SbomError::TooLarge);
    }
    let root: Value =
        serde_json::from_slice(bytes).map_err(|e| SbomError::NotJson(e.to_string()))?;
    let mut found = Vec::new();
    match format {
        SbomFormat::Cyclonedx => {
            if root.get("bomFormat").and_then(Value::as_str) != Some("CycloneDX") {
                return Err(SbomError::WrongFormat("CycloneDX"));
            }
            collect_cyclonedx(root.get("components"), &mut found)?;
        }
        SbomFormat::Spdx => {
            if root.get("spdxVersion").and_then(Value::as_str).is_none() {
                return Err(SbomError::WrongFormat("SPDX"));
            }
            collect_spdx(root.get("packages"), &mut found)?;
        }
    }
    Ok(dedupe(found))
}

fn collect_cyclonedx(list: Option<&Value>, out: &mut Vec<SbomComponent>) -> Result<(), SbomError> {
    for item in list.and_then(Value::as_array).into_iter().flatten() {
        if out.len() > MAX_COMPONENTS {
            return Err(SbomError::TooManyComponents);
        }
        if let Some(component) = read_cyclonedx(item) {
            out.push(component);
        }
        collect_cyclonedx(item.get("components"), out)?;
    }
    Ok(())
}

fn read_cyclonedx(item: &Value) -> Option<SbomComponent> {
    // Files and data sets are not software we can look up.
    if matches!(text(item, "type").as_deref(), Some("file" | "data")) {
        return None;
    }
    Some(SbomComponent {
        name: text(item, "name")?,
        version: text(item, "version"),
        vendor: text(item, "group").or_else(|| text(item, "publisher")),
        purl: text(item, "purl"),
        cpe: text(item, "cpe"),
    })
}

fn collect_spdx(list: Option<&Value>, out: &mut Vec<SbomComponent>) -> Result<(), SbomError> {
    for item in list.and_then(Value::as_array).into_iter().flatten() {
        if out.len() > MAX_COMPONENTS {
            return Err(SbomError::TooManyComponents);
        }
        if let Some(component) = read_spdx(item) {
            out.push(component);
        }
    }
    Ok(())
}

fn read_spdx(item: &Value) -> Option<SbomComponent> {
    Some(SbomComponent {
        name: text(item, "name")?,
        version: text(item, "versionInfo"),
        vendor: text(item, "supplier").map(strip_supplier_prefix),
        purl: external_ref(item, "purl"),
        cpe: external_ref(item, "cpe23Type"),
    })
}

fn strip_supplier_prefix(supplier: String) -> String {
    supplier
        .strip_prefix("Organization: ")
        .or_else(|| supplier.strip_prefix("Person: "))
        .unwrap_or(&supplier)
        .to_string()
}

fn external_ref(package: &Value, kind: &str) -> Option<String> {
    package
        .get("externalRefs")?
        .as_array()?
        .iter()
        .find(|r| r.get("referenceType").and_then(Value::as_str) == Some(kind))
        .and_then(|r| text(r, "referenceLocator"))
}

/// A string field, trimmed and cut to a sane length. Empty and "NOASSERTION" count as missing.
fn text(item: &Value, key: &str) -> Option<String> {
    let value = item.get(key)?.as_str()?.trim();
    if value.is_empty() || value == "NOASSERTION" || value == "NONE" {
        return None;
    }
    Some(value.chars().take(MAX_FIELD_CHARS).collect())
}

fn dedupe(components: Vec<SbomComponent>) -> Vec<SbomComponent> {
    let mut seen = HashSet::new();
    components
        .into_iter()
        .filter(|c| seen.insert(c.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const CYCLONEDX: &str = include_str!("../tests/fixtures/sbom/cyclonedx.json");
    const SPDX: &str = include_str!("../tests/fixtures/sbom/spdx.json");

    fn names(components: &[SbomComponent]) -> Vec<&str> {
        components.iter().map(|c| c.name.as_str()).collect()
    }

    #[test]
    fn cyclonedx_components_are_read_including_nested_ones() {
        let found = parse(SbomFormat::Cyclonedx, CYCLONEDX.as_bytes()).unwrap();
        assert_eq!(
            names(&found),
            [
                "log4j-core",
                "openssl",
                "zlib",
                "left-pad",
                "radio-fw",
                "mystery-lib"
            ]
        );
    }

    #[test]
    fn cyclonedx_fields_are_mapped() {
        let found = parse(SbomFormat::Cyclonedx, CYCLONEDX.as_bytes()).unwrap();
        let log4j = &found[0];
        assert_eq!(log4j.version.as_deref(), Some("2.14.1"));
        assert_eq!(log4j.vendor.as_deref(), Some("org.apache.logging.log4j"));
        assert_eq!(
            log4j.purl.as_deref(),
            Some("pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1")
        );
    }

    #[test]
    fn duplicate_components_are_listed_once() {
        let found = parse(SbomFormat::Cyclonedx, CYCLONEDX.as_bytes()).unwrap();
        assert_eq!(found.iter().filter(|c| c.name == "left-pad").count(), 1);
    }

    #[test]
    fn files_and_nameless_components_are_skipped() {
        let found = parse(SbomFormat::Cyclonedx, CYCLONEDX.as_bytes()).unwrap();
        assert!(!names(&found).contains(&"/etc/passwd"));
        assert!(found.iter().all(|c| !c.name.is_empty()));
    }

    #[test]
    fn a_component_without_identifiers_is_still_listed() {
        let found = parse(SbomFormat::Cyclonedx, CYCLONEDX.as_bytes()).unwrap();
        let mystery = found.iter().find(|c| c.name == "mystery-lib").unwrap();
        assert_eq!(
            (
                mystery.purl.as_deref(),
                mystery.cpe.as_deref(),
                mystery.version.as_deref()
            ),
            (None, None, None)
        );
    }

    #[test]
    fn cyclonedx_cpe_is_kept() {
        let found = parse(SbomFormat::Cyclonedx, CYCLONEDX.as_bytes()).unwrap();
        let radio = found.iter().find(|c| c.name == "radio-fw").unwrap();
        assert!(radio.cpe.as_deref().unwrap().starts_with("cpe:2.3:o:acme"));
    }

    #[test]
    fn spdx_packages_are_read_with_purl_and_cpe() {
        let found = parse(SbomFormat::Spdx, SPDX.as_bytes()).unwrap();
        assert_eq!(names(&found), ["curl", "vendor-blob", "nothing-known"]);
        let curl = &found[0];
        assert_eq!(curl.vendor.as_deref(), Some("curl project"));
        assert!(curl
            .purl
            .as_deref()
            .unwrap()
            .starts_with("pkg:deb/ubuntu/curl@7.68.0"));
        assert!(curl
            .cpe
            .as_deref()
            .unwrap()
            .starts_with("cpe:2.3:a:haxx:curl"));
    }

    #[test]
    fn spdx_noassertion_means_no_version() {
        let found = parse(SbomFormat::Spdx, SPDX.as_bytes()).unwrap();
        assert_eq!(found[2].version, None);
    }

    #[test]
    fn the_wrong_format_is_refused() {
        let err = parse(SbomFormat::Spdx, CYCLONEDX.as_bytes()).unwrap_err();
        assert_eq!(err, SbomError::WrongFormat("SPDX"));
        let err = parse(SbomFormat::Cyclonedx, SPDX.as_bytes()).unwrap_err();
        assert_eq!(err, SbomError::WrongFormat("CycloneDX"));
    }

    #[test]
    fn text_that_is_not_json_is_refused() {
        let err = parse(SbomFormat::Cyclonedx, b"<xml/>").unwrap_err();
        assert!(matches!(err, SbomError::NotJson(_)));
    }

    #[test]
    fn deeply_nested_json_is_refused_not_crashed() {
        let deep = format!("{}{}", "[".repeat(10_000), "]".repeat(10_000));
        let err = parse(SbomFormat::Cyclonedx, deep.as_bytes()).unwrap_err();
        assert!(matches!(err, SbomError::NotJson(_)));
    }

    fn nested_components(levels: usize) -> String {
        let mut json = String::new();
        for _ in 0..levels {
            json.push_str(r#"{"name":"x","components":["#);
        }
        json.push_str("{\"name\":\"leaf\"}");
        json.push_str(&"]}".repeat(levels));
        format!(r#"{{"bomFormat":"CycloneDX","components":[{json}]}}"#)
    }

    #[test]
    fn reasonably_nested_components_are_read() {
        let found = parse(SbomFormat::Cyclonedx, nested_components(50).as_bytes()).unwrap();
        assert!(found.iter().any(|c| c.name == "leaf"));
    }

    #[test]
    fn components_nested_past_the_json_depth_limit_are_refused() {
        let err = parse(SbomFormat::Cyclonedx, nested_components(100).as_bytes()).unwrap_err();
        assert!(matches!(err, SbomError::NotJson(_)));
    }

    #[test]
    fn too_many_components_are_refused() {
        let item = (0..=MAX_COMPONENTS + 1)
            .map(|i| format!(r#"{{"name":"c{i}"}}"#))
            .collect::<Vec<_>>()
            .join(",");
        let doc = format!(r#"{{"bomFormat":"CycloneDX","components":[{item}]}}"#);
        let err = parse(SbomFormat::Cyclonedx, doc.as_bytes()).unwrap_err();
        assert_eq!(err, SbomError::TooManyComponents);
    }

    #[test]
    fn long_names_are_cut() {
        let long = "n".repeat(1000);
        let doc = format!(r#"{{"bomFormat":"CycloneDX","components":[{{"name":"{long}"}}]}}"#);
        let found = parse(SbomFormat::Cyclonedx, doc.as_bytes()).unwrap();
        assert_eq!(found[0].name.chars().count(), 255);
    }

    #[test]
    fn path_like_names_are_plain_text() {
        let doc =
            r#"{"bomFormat":"CycloneDX","components":[{"name":"../../etc/passwd","version":"1"}]}"#;
        let found = parse(SbomFormat::Cyclonedx, doc.as_bytes()).unwrap();
        assert_eq!(found[0].name, "../../etc/passwd");
    }

    #[test]
    fn numbers_where_text_is_expected_are_ignored_not_fatal() {
        let doc = r#"{"bomFormat":"CycloneDX","components":[{"name":"a","version":1.5}]}"#;
        let found = parse(SbomFormat::Cyclonedx, doc.as_bytes()).unwrap();
        assert_eq!(found[0].version, None);
    }
}
