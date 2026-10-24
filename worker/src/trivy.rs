//! Running Trivy and reading its JSON. Trivy is started with an argument list, never
//! through a shell, and the SBOM goes in as a file we wrote ourselves.
//!
//! `--list-all-pkgs` makes Trivy list every package it understood. Only those count as
//! checked: Trivy's silence about a package it does not know must not read as "no known
//! vulnerabilities".

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use chrono::{DateTime, Utc};
use serde_json::Value;
use thiserror::Error;
use tokio::process::Command;
use tracing::debug;

use crate::contract::Severity;
use crate::error::JobError;

#[derive(Debug, Error)]
pub enum TrivyError {
    #[error("the Trivy database is missing")]
    DbMissing,
    #[error("could not start Trivy: {0}")]
    Spawn(std::io::Error),
    #[error("Trivy exited with {status}: {stderr}")]
    Failed { status: String, stderr: String },
    #[error("Trivy output was not understood: {0}")]
    BadOutput(String),
}

impl From<TrivyError> for JobError {
    fn from(err: TrivyError) -> Self {
        match err {
            TrivyError::DbMissing => Self::TrivyDbMissing,
            other => Self::TrivyFailed(other.to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrivyFinding {
    /// Normalized package URL (no qualifiers). `None` when Trivy gave none.
    pub purl: Option<String>,
    pub package_name: String,
    pub installed_version: Option<String>,
    pub vulnerability_id: String,
    pub severity: Severity,
    pub cvss_score: Option<f64>,
    pub cvss_vector: Option<String>,
    pub fixed_version: Option<String>,
    pub summary: String,
    pub references: Vec<String>,
    pub published_at: Option<DateTime<Utc>>,
    pub modified_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Default)]
pub struct TrivyReport {
    /// Normalized purls of every package Trivy understood.
    pub understood: HashSet<String>,
    pub findings: Vec<TrivyFinding>,
}

/// Drops qualifiers (`?arch=...`) and subpath (`#...`) so SBOM and Trivy purls compare equal.
pub fn normalize_purl(purl: &str) -> String {
    let end = purl.find(['?', '#']).unwrap_or(purl.len());
    purl[..end].to_string()
}

pub fn parse_report(json: &str) -> Result<TrivyReport, TrivyError> {
    let root: Value =
        serde_json::from_str(json).map_err(|e| TrivyError::BadOutput(e.to_string()))?;
    if !root.is_object() {
        return Err(TrivyError::BadOutput("expected a JSON object".into()));
    }
    let mut report = TrivyReport::default();
    for result in root
        .get("Results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        for package in array(result, "Packages") {
            if let Some(purl) = package.pointer("/Identifier/PURL").and_then(Value::as_str) {
                report.understood.insert(normalize_purl(purl));
            }
        }
        report
            .findings
            .extend(array(result, "Vulnerabilities").filter_map(read_finding));
    }
    Ok(report)
}

fn array<'a>(value: &'a Value, key: &str) -> impl Iterator<Item = &'a Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

fn read_finding(v: &Value) -> Option<TrivyFinding> {
    let id = text(v, "VulnerabilityID")?;
    let (cvss_score, cvss_vector) = best_cvss(v.get("CVSS"));
    let mut references: Vec<String> = array(v, "References")
        .filter_map(|r| r.as_str().map(str::to_string))
        .collect();
    if let Some(primary) = text(v, "PrimaryURL") {
        references.insert(0, primary);
    }
    Some(TrivyFinding {
        purl: v
            .pointer("/PkgIdentifier/PURL")
            .and_then(Value::as_str)
            .map(normalize_purl),
        package_name: text(v, "PkgName").unwrap_or_default(),
        installed_version: text(v, "InstalledVersion"),
        vulnerability_id: id,
        severity: severity(text(v, "Severity").as_deref()),
        cvss_score,
        cvss_vector,
        fixed_version: text(v, "FixedVersion"),
        summary: text(v, "Title")
            .or_else(|| text(v, "Description"))
            .unwrap_or_else(|| "No description available.".to_string()),
        references,
        published_at: date(v, "PublishedDate"),
        modified_at: date(v, "LastModifiedDate"),
    })
}

fn text(v: &Value, key: &str) -> Option<String> {
    let s = v.get(key)?.as_str()?.trim();
    (!s.is_empty()).then(|| s.to_string())
}

fn date(v: &Value, key: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(v.get(key)?.as_str()?)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

fn severity(word: Option<&str>) -> Severity {
    match word.map(str::to_ascii_uppercase).as_deref() {
        Some("CRITICAL") => Severity::Critical,
        Some("HIGH") => Severity::High,
        Some("MEDIUM") => Severity::Medium,
        Some("LOW") => Severity::Low,
        _ => Severity::Unknown,
    }
}

/// NVD's own CVSS v3 first, then any v3, then v2.
fn best_cvss(cvss: Option<&Value>) -> (Option<f64>, Option<String>) {
    let Some(sources) = cvss.and_then(Value::as_object) else {
        return (None, None);
    };
    let ordered: Vec<&Value> = sources
        .get("nvd")
        .into_iter()
        .chain(sources.iter().filter(|(k, _)| *k != "nvd").map(|(_, v)| v))
        .collect();
    for (score_key, vector_key) in [("V3Score", "V3Vector"), ("V2Score", "V2Vector")] {
        if let Some(source) = ordered
            .iter()
            .find(|s| s.get(score_key).is_some_and(Value::is_number))
        {
            return (
                source.get(score_key).and_then(Value::as_f64),
                text(source, vector_key),
            );
        }
    }
    (None, None)
}

#[derive(Debug, Clone)]
pub struct Trivy {
    path: PathBuf,
    cache_dir: PathBuf,
}

impl Trivy {
    pub fn new(path: PathBuf, cache_dir: PathBuf) -> Self {
        Self { path, cache_dir }
    }

    pub fn db_file(&self) -> PathBuf {
        self.cache_dir.join("db").join("trivy.db")
    }

    pub fn has_db(&self) -> bool {
        self.db_file().is_file()
    }

    /// Scans one SBOM file offline. The database must already be downloaded.
    pub async fn scan_sbom(&self, sbom_file: &Path) -> Result<TrivyReport, TrivyError> {
        if !self.has_db() {
            return Err(TrivyError::DbMissing);
        }
        let mut command = Command::new(&self.path);
        command
            .args(["sbom", "--format", "json", "--scanners", "vuln"])
            .args([
                "--list-all-pkgs",
                "--skip-db-update",
                "--offline-scan",
                "--quiet",
            ])
            .arg("--cache-dir")
            .arg(&self.cache_dir)
            .arg(sbom_file);
        let stdout = self.run(command).await?;
        parse_report(&stdout)
    }

    /// Downloads the vulnerability database. Returns when it was last updated upstream.
    pub async fn update_db(&self) -> Result<Option<DateTime<Utc>>, TrivyError> {
        let mut command = Command::new(&self.path);
        command
            .args(["image", "--download-db-only", "--quiet"])
            .arg("--cache-dir")
            .arg(&self.cache_dir);
        self.run(command).await?;
        Ok(self.db_updated_at().await)
    }

    /// `UpdatedAt` from `db/metadata.json`, when the database is there.
    pub async fn db_updated_at(&self) -> Option<DateTime<Utc>> {
        let text = tokio::fs::read_to_string(self.cache_dir.join("db").join("metadata.json"))
            .await
            .ok()?;
        parse_metadata_time(&text)
    }

    async fn run(&self, mut command: Command) -> Result<String, TrivyError> {
        // kill_on_drop: when the job times out, the future is dropped and Trivy is killed.
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        debug!(program = %self.path.display(), "starting trivy");
        let output = command.output().await.map_err(TrivyError::Spawn)?;
        if !output.status.success() {
            return Err(TrivyError::Failed {
                status: output.status.to_string(),
                stderr: tail(&String::from_utf8_lossy(&output.stderr), 500),
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

fn parse_metadata_time(json: &str) -> Option<DateTime<Utc>> {
    let value: Value = serde_json::from_str(json).ok()?;
    date(&value, "UpdatedAt")
}

fn tail(text: &str, max_chars: usize) -> String {
    let chars: Vec<char> = text.trim().chars().collect();
    let start = chars.len().saturating_sub(max_chars);
    chars[start..].iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPORT: &str = include_str!("../tests/fixtures/trivy/report.json");

    #[test]
    fn qualifiers_and_subpaths_are_dropped_from_purls() {
        assert_eq!(
            normalize_purl("pkg:generic/zlib@1.2.11?arch=arm64"),
            "pkg:generic/zlib@1.2.11"
        );
        assert_eq!(normalize_purl("pkg:npm/a@1#sub/path"), "pkg:npm/a@1");
        assert_eq!(normalize_purl("pkg:npm/a@1"), "pkg:npm/a@1");
    }

    #[test]
    fn understood_packages_come_from_the_package_lists() {
        let report = parse_report(REPORT).unwrap();
        let mut purls: Vec<_> = report.understood.iter().cloned().collect();
        purls.sort();
        assert_eq!(
            purls,
            [
                "pkg:generic/zlib@1.2.11",
                "pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1"
            ]
        );
    }

    #[test]
    fn findings_carry_severity_fix_and_summary() {
        let report = parse_report(REPORT).unwrap();
        let log4shell = &report.findings[0];
        assert_eq!(log4shell.vulnerability_id, "CVE-2021-44228");
        assert_eq!(log4shell.severity, Severity::Critical);
        assert_eq!(log4shell.fixed_version.as_deref(), Some("2.15.0"));
        assert_eq!(
            log4shell.summary,
            "log4j: Remote code execution via JNDI lookups"
        );
    }

    #[test]
    fn nvd_cvss_v3_is_preferred() {
        let report = parse_report(REPORT).unwrap();
        assert_eq!(report.findings[0].cvss_score, Some(10.0));
        assert!(report.findings[0]
            .cvss_vector
            .as_deref()
            .unwrap()
            .starts_with("CVSS:3.1/AV:N/AC:L"));
    }

    #[test]
    fn a_finding_without_a_fix_or_score_is_kept() {
        let report = parse_report(REPORT).unwrap();
        let ghsa = &report.findings[1];
        assert_eq!(ghsa.vulnerability_id, "GHSA-8489-44mv-ggj8");
        assert_eq!(ghsa.fixed_version, None);
        assert_eq!(ghsa.cvss_score, None);
        assert_eq!(ghsa.severity, Severity::Medium);
    }

    #[test]
    fn finding_purls_are_normalized_to_match_the_sbom() {
        let report = parse_report(REPORT).unwrap();
        assert_eq!(
            report.findings[1].purl.as_deref(),
            Some("pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1")
        );
    }

    #[test]
    fn primary_url_comes_first_in_references() {
        let report = parse_report(REPORT).unwrap();
        assert_eq!(
            report.findings[0].references[0],
            "https://avd.aquasec.com/nvd/cve-2021-44228"
        );
        assert_eq!(report.findings[0].references.len(), 3);
    }

    #[test]
    fn dates_are_read() {
        let report = parse_report(REPORT).unwrap();
        assert_eq!(
            report.findings[0].published_at.map(|d| d.to_rfc3339()),
            Some("2021-12-10T10:15:09.143+00:00".to_string())
        );
    }

    #[test]
    fn a_report_without_results_is_empty_not_an_error() {
        let report =
            parse_report(include_str!("../tests/fixtures/trivy/report-empty.json")).unwrap();
        assert!(report.understood.is_empty());
        assert!(report.findings.is_empty());
    }

    #[test]
    fn output_that_is_not_json_is_an_error() {
        assert!(parse_report("Fatal error: no db").is_err());
        assert!(parse_report("[]").is_err());
    }

    #[test]
    fn unknown_severity_words_become_unknown() {
        assert_eq!(severity(Some("WEIRD")), Severity::Unknown);
        assert_eq!(severity(None), Severity::Unknown);
    }

    #[test]
    fn metadata_time_is_read() {
        let text = include_str!("../tests/fixtures/trivy/metadata.json");
        let time = parse_metadata_time(text).unwrap();
        assert_eq!(time.to_rfc3339(), "2026-10-24T00:00:00.987654321+00:00");
    }

    #[test]
    fn tail_keeps_the_end_of_long_text() {
        assert_eq!(tail("abcdef", 3), "def");
        assert_eq!(tail("ab", 3), "ab");
    }

    #[tokio::test]
    async fn scanning_without_a_database_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let trivy = Trivy::new("trivy-does-not-exist".into(), dir.path().to_path_buf());
        let err = trivy.scan_sbom(Path::new("/nope")).await.unwrap_err();
        assert!(matches!(err, TrivyError::DbMissing));
    }

    #[tokio::test]
    async fn a_missing_binary_is_a_spawn_error() {
        let dir = tempfile::tempdir().unwrap();
        let trivy = Trivy::new("/definitely/not/trivy".into(), dir.path().to_path_buf());
        let err = trivy.update_db().await.unwrap_err();
        assert!(matches!(err, TrivyError::Spawn(_)));
    }
}
