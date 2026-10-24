//! Risk level and device status rules (architecture section 5).
//! The web app has the same level rules in `web/src/lib/contracts/risk.ts`; both run
//! `contracts/risk-levels.json`. Only this module's result is ever written to `device.status`.

use serde::Deserialize;

use crate::contract::{ComponentCheck, DeviceStatus, Severity};

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
}
