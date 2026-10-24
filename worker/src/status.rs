//! Risk level and device status rules (architecture section 5).
//! The web app has the same level rules in `web/src/lib/contracts/risk.ts`; both run
//! `contracts/risk-levels.json`. Only this module's result is ever written to `device.status`.

use serde::Deserialize;
use sqlx::PgConnection;

use crate::contract::{ComponentCheck, ComponentSource, DeviceStatus, Severity};
use crate::version::Version;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Critical,
    Vulnerable,
    Low,
}

/// Score used when NVD gave a severity word but no CVSS number: the bottom of that band.
pub fn effective_score(cvss_score: Option<f64>, severity: Severity) -> Option<f64> {
    cvss_score.or(match severity {
        Severity::Critical => Some(9.0),
        Severity::High => Some(7.0),
        Severity::Medium => Some(4.0),
        Severity::Low => Some(0.1),
        Severity::Unknown => None,
    })
}

pub fn risk_level(cvss_score: Option<f64>, severity: Severity, exploited: bool) -> RiskLevel {
    let score = effective_score(cvss_score, severity);
    match score {
        _ if exploited => RiskLevel::Critical,
        Some(s) if s >= 9.0 => RiskLevel::Critical,
        Some(s) if s >= 4.0 => RiskLevel::Vulnerable,
        _ => RiskLevel::Low,
    }
}

/// Derives the device status from its open findings and the checks of its components.
/// `open_levels` holds the level of every open finding; ignored findings are left out by the caller.
pub fn derive_status(
    open_levels: &[RiskLevel],
    component_checks: &[ComponentCheck],
) -> DeviceStatus {
    if open_levels.contains(&RiskLevel::Critical) {
        DeviceStatus::Critical
    } else if open_levels.contains(&RiskLevel::Vulnerable) {
        DeviceStatus::Vulnerable
    } else if !open_levels.is_empty() {
        DeviceStatus::UpdateAvailable
    } else if component_checks.contains(&ComponentCheck::Checked) {
        DeviceStatus::NoKnownVulns
    } else {
        DeviceStatus::NotTracked
    }
}

/// What the status needs to know about one component.
#[derive(Debug, Clone, Copy)]
pub struct ComponentFacts {
    pub check: ComponentCheck,
}

/// What the status needs to know about one open finding.
#[derive(Debug, Clone)]
pub struct OpenFinding {
    pub source: ComponentSource,
    pub level: RiskLevel,
    pub fixed_version: Option<String>,
}

/// The device columns the worker owns (ADR 0004).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceSummary {
    pub status: DeviceStatus,
    pub open_finding_count: i32,
    pub component_count: i32,
    pub unchecked_count: i32,
    pub target_version: Option<String>,
}

pub fn summarize(components: &[ComponentFacts], findings: &[OpenFinding]) -> DeviceSummary {
    let levels: Vec<RiskLevel> = findings.iter().map(|f| f.level).collect();
    let checks: Vec<ComponentCheck> = components.iter().map(|c| c.check).collect();
    let nothing_looked_at_yet =
        !checks.is_empty() && checks.iter().all(|c| *c == ComponentCheck::Pending);
    let status = if nothing_looked_at_yet && findings.is_empty() {
        DeviceStatus::Pending
    } else {
        derive_status(&levels, &checks)
    };
    DeviceSummary {
        status,
        open_finding_count: count(findings.len()),
        component_count: count(components.len()),
        unchecked_count: count(
            checks
                .iter()
                .filter(|c| **c != ComponentCheck::Checked)
                .count(),
        ),
        target_version: target_version(findings),
    }
}

fn count(n: usize) -> i32 {
    i32::try_from(n).unwrap_or(i32::MAX)
}

/// The highest fix among open findings of the manual product ("Update to <version>").
/// Fixes we cannot compare are skipped.
fn target_version(findings: &[OpenFinding]) -> Option<String> {
    findings
        .iter()
        .filter(|f| f.source == ComponentSource::Manual)
        .filter_map(|f| {
            let text = f.fixed_version.as_deref()?;
            Some((Version::parse(text)?, text))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, text)| text.to_string())
}

#[derive(sqlx::FromRow)]
struct FindingRow {
    source: ComponentSource,
    fixed_version: Option<String>,
    cvss_score: Option<f64>,
    severity: Severity,
    exploited: bool,
}

/// Recomputes status and counts of one device from its rows and writes them.
/// Call inside the transaction that holds the device lock. Raw SQL on purpose: only the
/// worker writes these columns, and `updated_at` must not change.
pub async fn recompute_device(
    conn: &mut PgConnection,
    device_id: &str,
) -> Result<DeviceSummary, sqlx::Error> {
    let checks: Vec<ComponentCheck> =
        sqlx::query_scalar(r#"SELECT "check" FROM component WHERE device_id = $1"#)
            .bind(device_id)
            .fetch_all(&mut *conn)
            .await?;
    let rows: Vec<FindingRow> = sqlx::query_as(
        "SELECT c.source, f.fixed_version, v.cvss_score, v.severity, v.exploited
         FROM finding f
         JOIN component c ON c.id = f.component_id
         JOIN vulnerability v ON v.id = f.vulnerability_id
         WHERE f.device_id = $1 AND f.state = 'OPEN'",
    )
    .bind(device_id)
    .fetch_all(&mut *conn)
    .await?;

    let components: Vec<ComponentFacts> = checks
        .into_iter()
        .map(|check| ComponentFacts { check })
        .collect();
    let findings: Vec<OpenFinding> = rows
        .into_iter()
        .map(|r| OpenFinding {
            source: r.source,
            level: risk_level(r.cvss_score, r.severity, r.exploited),
            fixed_version: r.fixed_version,
        })
        .collect();
    let summary = summarize(&components, &findings);

    sqlx::query(
        "UPDATE device SET status = $2, open_finding_count = $3, component_count = $4,
           unchecked_count = $5, target_version = $6 WHERE id = $1",
    )
    .bind(device_id)
    .bind(summary.status)
    .bind(summary.open_finding_count)
    .bind(summary.component_count)
    .bind(summary.unchecked_count)
    .bind(&summary.target_version)
    .execute(&mut *conn)
    .await?;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exploited_is_critical_even_with_low_score() {
        assert_eq!(
            risk_level(Some(1.0), Severity::Low, true),
            RiskLevel::Critical
        );
    }

    #[test]
    fn nine_is_critical_and_below_is_vulnerable() {
        assert_eq!(
            risk_level(Some(9.0), Severity::High, false),
            RiskLevel::Critical
        );
        assert_eq!(
            risk_level(Some(8.9), Severity::High, false),
            RiskLevel::Vulnerable
        );
    }

    #[test]
    fn unknown_severity_without_score_is_low() {
        assert_eq!(risk_level(None, Severity::Unknown, false), RiskLevel::Low);
    }

    #[test]
    fn severity_word_stands_in_for_a_missing_score() {
        assert_eq!(effective_score(None, Severity::High), Some(7.0));
    }

    #[test]
    fn no_findings_and_nothing_checked_is_not_tracked() {
        assert_eq!(
            derive_status(&[], &[ComponentCheck::NoIdentifier]),
            DeviceStatus::NotTracked
        );
    }

    #[test]
    fn no_components_is_not_tracked() {
        assert_eq!(derive_status(&[], &[]), DeviceStatus::NotTracked);
    }

    fn finding(source: ComponentSource, level: RiskLevel, fix: Option<&str>) -> OpenFinding {
        OpenFinding {
            source,
            level,
            fixed_version: fix.map(str::to_string),
        }
    }

    fn facts(checks: &[ComponentCheck]) -> Vec<ComponentFacts> {
        checks
            .iter()
            .map(|c| ComponentFacts { check: *c })
            .collect()
    }

    #[test]
    fn counts_unchecked_components() {
        let summary = summarize(
            &facts(&[
                ComponentCheck::Checked,
                ComponentCheck::Unsupported,
                ComponentCheck::NoVersion,
            ]),
            &[],
        );
        assert_eq!(summary.component_count, 3);
        assert_eq!(summary.unchecked_count, 2);
        assert_eq!(summary.status, DeviceStatus::NoKnownVulns);
    }

    #[test]
    fn a_device_nobody_looked_at_yet_stays_pending() {
        let summary = summarize(&facts(&[ComponentCheck::Pending]), &[]);
        assert_eq!(summary.status, DeviceStatus::Pending);
    }

    #[test]
    fn target_version_is_the_highest_fix_of_the_manual_product() {
        let findings = [
            finding(ComponentSource::Manual, RiskLevel::Vulnerable, Some("10.2")),
            finding(ComponentSource::Manual, RiskLevel::Critical, Some("10.10")),
            finding(ComponentSource::Sbom, RiskLevel::Low, Some("99.0")),
        ];
        let summary = summarize(&facts(&[ComponentCheck::Checked]), &findings);
        assert_eq!(summary.target_version.as_deref(), Some("10.10"));
        assert_eq!(summary.status, DeviceStatus::Critical);
        assert_eq!(summary.open_finding_count, 3);
    }

    #[test]
    fn fixes_that_cannot_be_compared_are_skipped() {
        let findings = [
            finding(ComponentSource::Manual, RiskLevel::Low, Some("soon")),
            finding(ComponentSource::Manual, RiskLevel::Low, None),
        ];
        let summary = summarize(&facts(&[ComponentCheck::Checked]), &findings);
        assert_eq!(summary.target_version, None);
        assert_eq!(summary.status, DeviceStatus::UpdateAvailable);
    }
}
