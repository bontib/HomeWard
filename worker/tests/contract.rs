//! Keeps the worker in step with the web app: enums vs the Prisma schema, job payloads and
//! risk rules vs the shared fixtures in `contracts/` (docs/adr/0003).
#![allow(clippy::expect_used)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;
use worker::contract::*;
use worker::status::{derive_status, risk_level, RiskLevel};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("worker/ has a parent directory")
        .to_path_buf()
}

fn read_json<T: DeserializeOwned>(path: &Path) -> T {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("read {path:?}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {path:?}: {e}"))
}

fn json_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("read dir {dir:?}: {e}"))
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();
    files
}

/// Variants of every `enum` block in schema.prisma, in file order. Comments and `@@map` are skipped.
fn prisma_enums() -> BTreeMap<String, Vec<String>> {
    let schema = fs::read_to_string(repo_root().join("web/prisma/schema.prisma"))
        .expect("schema.prisma is readable");
    let mut enums = BTreeMap::new();
    let mut current: Option<(String, Vec<String>)> = None;
    for line in schema.lines() {
        let line = line.split("//").next().unwrap_or("").trim();
        if let Some(rest) = line.strip_prefix("enum ") {
            let name = rest.trim_end_matches('{').trim().to_string();
            current = Some((name, Vec::new()));
        } else if line == "}" {
            if let Some((name, variants)) = current.take() {
                enums.insert(name, variants);
            }
        } else if let Some((_, variants)) = current.as_mut() {
            if !line.is_empty() && !line.starts_with("@@") {
                variants.push(line.to_string());
            }
        }
    }
    enums
}

fn names<T: serde::Serialize>(all: &[T]) -> Vec<String> {
    all.iter()
        .map(|v| match serde_json::to_value(v) {
            Ok(Value::String(s)) => s,
            other => panic!("enum did not serialize to a string: {other:?}"),
        })
        .collect()
}

#[test]
fn rust_enums_have_the_same_variants_as_the_prisma_schema() {
    let rust: BTreeMap<&str, Vec<String>> = BTreeMap::from([
        ("DeviceType", names(DeviceType::ALL)),
        ("DeviceStatus", names(DeviceStatus::ALL)),
        ("CheckState", names(CheckState::ALL)),
        ("Severity", names(Severity::ALL)),
        ("FindingState", names(FindingState::ALL)),
        ("FindingSource", names(FindingSource::ALL)),
        ("ComponentSource", names(ComponentSource::ALL)),
        ("ComponentCheck", names(ComponentCheck::ALL)),
        ("SbomFormat", names(SbomFormat::ALL)),
        ("JobType", names(JobType::ALL)),
        ("JobStatus", names(JobStatus::ALL)),
        ("JobErrorCode", names(JobErrorCode::ALL)),
        ("ProductSearchStatus", names(ProductSearchStatus::ALL)),
        ("DataSourceId", names(DataSourceId::ALL)),
    ]);
    let prisma = prisma_enums();

    let rust_names: Vec<&str> = rust.keys().copied().collect();
    let prisma_names: Vec<&str> = prisma.keys().map(String::as_str).collect();
    assert_eq!(rust_names, prisma_names, "enum lists differ");
    for (name, variants) in &rust {
        assert_eq!(
            Some(variants),
            prisma.get(*name),
            "variants of {name} differ"
        );
    }
}

#[test]
fn postgres_type_names_match_the_prisma_map_names() {
    // sqlx reads the type name from the derive; the schema maps each enum with @@map.
    let schema = fs::read_to_string(repo_root().join("web/prisma/schema.prisma")).unwrap();
    for type_name in [
        "device_type",
        "device_status",
        "check_state",
        "severity",
        "finding_state",
        "finding_source",
        "component_source",
        "component_check",
        "sbom_format",
        "job_type",
        "job_status",
        "job_error_code",
        "product_search_status",
        "data_source_id",
    ] {
        assert!(
            schema.contains(&format!("@@map(\"{type_name}\")")),
            "{type_name} is not mapped in schema.prisma"
        );
    }
}

fn job_type_from_file_name(path: &Path) -> JobType {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .expect("file name");
    let prefix = file_name.split('.').next().expect("name prefix");
    serde_json::from_value(Value::String(prefix.to_string()))
        .unwrap_or_else(|_| panic!("{file_name} does not start with a job type"))
}

#[test]
fn every_job_type_has_a_valid_fixture() {
    let dir = repo_root().join("contracts/jobs");
    let files = json_files(&dir);
    let mut covered: Vec<JobType> = files.iter().map(|p| job_type_from_file_name(p)).collect();
    covered.sort_by_key(|t| format!("{t:?}"));
    let mut expected = JobType::ALL.to_vec();
    expected.sort_by_key(|t| format!("{t:?}"));
    assert_eq!(covered, expected);
}

#[test]
fn valid_job_payload_fixtures_parse() {
    for path in json_files(&repo_root().join("contracts/jobs")) {
        let payload: Value = read_json(&path);
        let result = JobPayload::parse(job_type_from_file_name(&path), &payload);
        assert!(result.is_ok(), "{path:?} should parse: {result:?}");
    }
}

#[test]
fn invalid_job_payload_fixtures_are_rejected() {
    let files = json_files(&repo_root().join("contracts/jobs/invalid"));
    assert!(!files.is_empty(), "no invalid fixtures found");
    for path in files {
        let payload: Value = read_json(&path);
        let result = JobPayload::parse(job_type_from_file_name(&path), &payload);
        assert!(result.is_err(), "{path:?} should be rejected");
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LevelCase {
    cvss_score: Option<f64>,
    severity: Severity,
    exploited: bool,
    level: RiskLevel,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FindingCase {
    cvss_score: Option<f64>,
    severity: Severity,
    exploited: bool,
    state: FindingState,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusCase {
    name: String,
    findings: Vec<FindingCase>,
    component_checks: Vec<ComponentCheck>,
    expected: DeviceStatus,
}

#[derive(Deserialize)]
struct RiskFixture {
    levels: Vec<LevelCase>,
    #[serde(rename = "deviceStatus")]
    device_status: Vec<StatusCase>,
}

fn risk_fixture() -> RiskFixture {
    read_json(&repo_root().join("contracts/risk-levels.json"))
}

#[test]
fn risk_levels_match_the_shared_fixture() {
    for case in risk_fixture().levels {
        let actual = risk_level(case.cvss_score, case.severity, case.exploited);
        assert_eq!(
            actual, case.level,
            "score {:?}, severity {:?}, exploited {}",
            case.cvss_score, case.severity, case.exploited
        );
    }
}

#[test]
fn device_status_matches_the_shared_fixture() {
    for case in risk_fixture().device_status {
        let open_levels: Vec<RiskLevel> = case
            .findings
            .iter()
            .filter(|f| f.state == FindingState::Open)
            .map(|f| risk_level(f.cvss_score, f.severity, f.exploited))
            .collect();
        let actual = derive_status(&open_levels, &case.component_checks);
        assert_eq!(actual, case.expected, "case: {}", case.name);
    }
}
