//! Reads NVD API 2.0 JSON (CVE and CPE endpoints) into plain structs. No network here.

use chrono::{DateTime, NaiveDateTime, Utc};
use serde_json::Value;
use thiserror::Error;

use crate::contract::Severity;
use crate::cpe::{unescape, Cpe};
use crate::version::Version;

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("NVD answer has no `{0}` list")]
    MissingList(&'static str),
}

#[derive(Debug, Clone, PartialEq)]
pub struct NvdVuln {
    pub id: String,
    pub severity: Severity,
    pub cvss_score: Option<f64>,
    pub cvss_vector: Option<String>,
    pub summary: String,
    pub published_at: Option<DateTime<Utc>>,
    pub modified_at: Option<DateTime<Utc>>,
    pub references: Vec<String>,
    /// Raw NVD `configurations`; matched later by `cpe::match_configurations`.
    pub configurations: Value,
}

#[derive(Debug)]
pub struct CvePage {
    pub total_results: u64,
    pub vulnerabilities: Vec<NvdVuln>,
    /// How many entries NVD sent, including rejected ones we dropped. Used to page.
    pub received: u64,
}

pub fn parse_cve_page(body: &Value) -> Result<CvePage, ParseError> {
    let list = body
        .get("vulnerabilities")
        .and_then(Value::as_array)
        .ok_or(ParseError::MissingList("vulnerabilities"))?;
    let vulnerabilities = list
        .iter()
        .filter_map(|item| item.get("cve"))
        .filter_map(parse_cve)
        .collect();
    Ok(CvePage {
        total_results: body
            .get("totalResults")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        vulnerabilities,
        received: list.len() as u64,
    })
}

fn parse_cve(cve: &Value) -> Option<NvdVuln> {
    let id = cve.get("id")?.as_str()?.to_string();
    let summary = english_text(cve.get("descriptions")?, "value")?;
    if is_rejected(cve, &summary) {
        return None;
    }
    let metric = best_metric(cve.get("metrics"));
    Some(NvdVuln {
        id,
        severity: metric.severity,
        cvss_score: metric.score,
        cvss_vector: metric.vector,
        summary,
        published_at: cve
            .get("published")
            .and_then(Value::as_str)
            .and_then(nvd_time),
        modified_at: cve
            .get("lastModified")
            .and_then(Value::as_str)
            .and_then(nvd_time),
        references: urls(cve.get("references")),
        configurations: cve.get("configurations").cloned().unwrap_or(Value::Null),
    })
}

fn is_rejected(cve: &Value, summary: &str) -> bool {
    cve.get("vulnStatus").and_then(Value::as_str) == Some("Rejected")
        || summary.starts_with("** REJECT **")
}

/// English text if there is one, otherwise the first entry.
fn english_text(list: &Value, key: &str) -> Option<String> {
    let items = list.as_array()?;
    let pick = items
        .iter()
        .find(|i| i.get("lang").and_then(Value::as_str) == Some("en"))
        .or_else(|| items.first())?;
    pick.get(key).and_then(Value::as_str).map(str::to_string)
}

fn urls(references: Option<&Value>) -> Vec<String> {
    references
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|r| r.get("url").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

/// NVD times have no zone ("2024-03-12T18:15:00.000"); they are UTC.
fn nvd_time(text: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S%.f")
        .ok()
        .map(|t| t.and_utc())
}

struct Metric {
    score: Option<f64>,
    severity: Severity,
    vector: Option<String>,
}

/// Newest CVSS version first: 4.0, 3.1, 3.0, then 2.0.
fn best_metric(metrics: Option<&Value>) -> Metric {
    let none = Metric {
        score: None,
        severity: Severity::Unknown,
        vector: None,
    };
    let Some(metrics) = metrics else { return none };
    [
        "cvssMetricV40",
        "cvssMetricV31",
        "cvssMetricV30",
        "cvssMetricV2",
    ]
    .iter()
    .filter_map(|key| metrics.get(*key)?.as_array()?.first())
    .find_map(read_metric)
    .unwrap_or(none)
}

fn read_metric(entry: &Value) -> Option<Metric> {
    let data = entry.get("cvssData")?;
    let score = data.get("baseScore").and_then(Value::as_f64);
    // CVSS 2.0 keeps the severity word next to cvssData, newer versions inside it.
    let word = data
        .get("baseSeverity")
        .or_else(|| entry.get("baseSeverity"))
        .and_then(Value::as_str);
    let severity = word
        .and_then(severity_from_word)
        .or_else(|| score.map(severity_from_score))?;
    Some(Metric {
        score,
        severity,
        vector: data
            .get("vectorString")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn severity_from_word(word: &str) -> Option<Severity> {
    match word.to_ascii_uppercase().as_str() {
        "CRITICAL" => Some(Severity::Critical),
        "HIGH" => Some(Severity::High),
        "MEDIUM" => Some(Severity::Medium),
        "LOW" => Some(Severity::Low),
        _ => None,
    }
}

fn severity_from_score(score: f64) -> Severity {
    match score {
        s if s >= 9.0 => Severity::Critical,
        s if s >= 7.0 => Severity::High,
        s if s >= 4.0 => Severity::Medium,
        s if s > 0.0 => Severity::Low,
        _ => Severity::Unknown,
    }
}

/// One product (no version) found by a keyword search.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NvdProduct {
    pub cpe: String,
    pub part: String,
    pub vendor: String,
    pub product: String,
    pub title: String,
    pub latest_version: Option<String>,
}

/// Groups the versioned CPE names of a search answer into products, in NVD order.
pub fn parse_cpe_page(body: &Value, limit: usize) -> Result<Vec<NvdProduct>, ParseError> {
    let list = body
        .get("products")
        .and_then(Value::as_array)
        .ok_or(ParseError::MissingList("products"))?;
    let mut products: Vec<(NvdProduct, Option<Version>)> = Vec::new();
    for item in list {
        let Some(cpe) = item.get("cpe") else { continue };
        if cpe.get("deprecated").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let Some(name) = cpe.get("cpeName").and_then(Value::as_str) else {
            continue;
        };
        let Ok(parsed) = Cpe::parse(name) else {
            continue;
        };
        let version = known_version(&parsed);
        let title = clean_title(cpe.get("titles"), version.as_deref(), &parsed);
        let parsed_version = version.as_deref().and_then(Version::parse);
        add_to_group(&mut products, &parsed, title, version, parsed_version);
    }
    products.truncate(limit);
    Ok(products.into_iter().map(|(p, _)| p).collect())
}

fn known_version(cpe: &Cpe) -> Option<String> {
    match cpe.version.as_str() {
        "*" | "-" | "" => None,
        other => Some(unescape(other)),
    }
}

fn add_to_group(
    products: &mut Vec<(NvdProduct, Option<Version>)>,
    cpe: &Cpe,
    title: String,
    version: Option<String>,
    parsed_version: Option<Version>,
) {
    let base = cpe.base();
    if let Some((existing, best)) = products.iter_mut().find(|(p, _)| p.cpe == base) {
        if parsed_version.is_some() && parsed_version > *best {
            *best = parsed_version;
            existing.latest_version = version;
        }
        return;
    }
    products.push((
        NvdProduct {
            cpe: base,
            part: cpe.part.clone(),
            vendor: unescape(&cpe.vendor),
            product: unescape(&cpe.product),
            title,
            latest_version: parsed_version.is_some().then_some(version).flatten(),
        },
        parsed_version,
    ));
}

/// NVD titles end with the version ("Microsoft Xbox One Firmware 10.0.1"); a product title must not.
fn clean_title(titles: Option<&Value>, version: Option<&str>, cpe: &Cpe) -> String {
    let title = titles
        .and_then(|t| english_text(t, "title"))
        .unwrap_or_else(|| unescape(&cpe.product).replace('_', " "));
    let stripped = version
        .and_then(|v| title.strip_suffix(v))
        .map(str::trim_end)
        .filter(|t| !t.is_empty());
    stripped.unwrap_or(&title).to_string()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn cve_page() -> Value {
        serde_json::from_str(include_str!("../tests/fixtures/nvd/cves_xbox.json")).unwrap()
    }

    fn cpe_page() -> Value {
        serde_json::from_str(include_str!("../tests/fixtures/nvd/cpes_xbox.json")).unwrap()
    }

    #[test]
    fn rejected_cves_are_dropped_but_counted_as_received() {
        let page = parse_cve_page(&cve_page()).unwrap();
        assert_eq!(page.received, 4);
        let ids: Vec<_> = page.vulnerabilities.iter().map(|v| v.id.as_str()).collect();
        assert_eq!(ids, ["CVE-2024-1111", "CVE-2024-2222", "CVE-2024-3333"]);
    }

    #[test]
    fn cvss_31_wins_over_cvss_2() {
        let page = parse_cve_page(&cve_page()).unwrap();
        let first = &page.vulnerabilities[0];
        assert_eq!(first.cvss_score, Some(9.8));
        assert_eq!(first.severity, Severity::Critical);
        assert!(first
            .cvss_vector
            .as_deref()
            .unwrap()
            .starts_with("CVSS:3.1/"));
    }

    #[test]
    fn cvss_30_is_used_when_there_is_no_31() {
        let page = parse_cve_page(&cve_page()).unwrap();
        assert_eq!(page.vulnerabilities[1].severity, Severity::Medium);
        assert_eq!(page.vulnerabilities[1].cvss_score, Some(4.4));
    }

    #[test]
    fn a_cve_without_metrics_is_unknown_not_low() {
        let page = parse_cve_page(&cve_page()).unwrap();
        assert_eq!(page.vulnerabilities[2].severity, Severity::Unknown);
        assert_eq!(page.vulnerabilities[2].cvss_score, None);
    }

    #[test]
    fn english_description_is_preferred() {
        let page = parse_cve_page(&cve_page()).unwrap();
        assert!(page.vulnerabilities[0]
            .summary
            .starts_with("A flaw in the console"));
    }

    #[test]
    fn dates_without_a_zone_are_read_as_utc() {
        let page = parse_cve_page(&cve_page()).unwrap();
        let published = page.vulnerabilities[0].published_at.unwrap();
        assert_eq!(published.to_rfc3339(), "2024-03-12T18:15:00+00:00");
    }

    #[test]
    fn cvss_2_severity_word_is_read_from_the_metric() {
        let body = json!({"vulnerabilities": [{"cve": {
            "id": "CVE-2010-1", "descriptions": [{"lang": "en", "value": "old"}],
            "metrics": {"cvssMetricV2": [{"baseSeverity": "HIGH", "cvssData": {"baseScore": 7.5}}]}
        }}]});
        let page = parse_cve_page(&body).unwrap();
        assert_eq!(page.vulnerabilities[0].severity, Severity::High);
    }

    #[test]
    fn severity_is_derived_from_the_score_when_the_word_is_missing() {
        let body = json!({"vulnerabilities": [{"cve": {
            "id": "CVE-2010-2", "descriptions": [{"lang": "en", "value": "x"}],
            "metrics": {"cvssMetricV31": [{"cvssData": {"baseScore": 9.1}}]}
        }}]});
        let page = parse_cve_page(&body).unwrap();
        assert_eq!(page.vulnerabilities[0].severity, Severity::Critical);
    }

    #[test]
    fn an_answer_without_a_list_is_an_error() {
        assert!(parse_cve_page(&json!({"message": "oops"})).is_err());
        assert!(parse_cpe_page(&json!({}), 8).is_err());
    }

    #[test]
    fn cpe_versions_are_grouped_into_one_product() {
        let products = parse_cpe_page(&cpe_page(), 8).unwrap();
        let xbox_one: Vec<_> = products
            .iter()
            .filter(|p| p.cpe == "cpe:2.3:o:microsoft:xbox_one_firmware")
            .collect();
        assert_eq!(xbox_one.len(), 1);
        assert_eq!(xbox_one[0].title, "Microsoft Xbox One Firmware");
        assert_eq!(
            xbox_one[0].latest_version.as_deref(),
            Some("10.0.19041.1500")
        );
    }

    #[test]
    fn deprecated_products_are_left_out() {
        let products = parse_cpe_page(&cpe_page(), 8).unwrap();
        assert!(products.iter().all(|p| !p.cpe.contains("xbox_360")));
    }

    #[test]
    fn products_keep_nvd_order() {
        let cpes: Vec<_> = parse_cpe_page(&cpe_page(), 8)
            .unwrap()
            .into_iter()
            .map(|p| p.cpe)
            .collect();
        assert_eq!(
            cpes,
            [
                "cpe:2.3:o:microsoft:xbox_one_firmware",
                "cpe:2.3:a:microsoft:xbox",
                "cpe:2.3:h:microsoft:xbox_series_x",
                "cpe:2.3:a:xbox_live_tool_project:xbox_live_tool",
            ]
        );
    }

    #[test]
    fn a_product_without_version_has_no_latest_hint() {
        let products = parse_cpe_page(&cpe_page(), 8).unwrap();
        let plain = products
            .iter()
            .find(|p| p.cpe == "cpe:2.3:a:microsoft:xbox")
            .unwrap();
        assert_eq!(plain.latest_version, None);
        assert_eq!(plain.title, "Microsoft Xbox");
    }

    #[test]
    fn title_falls_back_to_the_first_language_and_strips_the_version() {
        let products = parse_cpe_page(&cpe_page(), 8).unwrap();
        let tool = products
            .iter()
            .find(|p| p.product == "xbox_live_tool")
            .unwrap();
        assert_eq!(tool.title, "Xbox Live Werkzeug");
    }

    #[test]
    fn the_limit_cuts_the_list() {
        assert_eq!(parse_cpe_page(&cpe_page(), 2).unwrap().len(), 2);
    }
}
