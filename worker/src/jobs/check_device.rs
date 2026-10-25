//! CHECK_DEVICE: finds the known vulnerabilities of one device and writes the result.
//!
//! Slow outside calls (NVD, Trivy) happen first, outside any transaction. Then one short
//! transaction, started by locking the device row, writes everything. Running the job twice
//! gives the same rows: findings are keyed on (component, vulnerability) and a finding's
//! `state` ("ignored") is never touched here.

use std::path::Path;

use sqlx::PgPool;
use tracing::{info, warn};

use crate::context::Context;
use crate::contract::{
    ComponentCheck, ComponentSource, DevicePayload, FindingSource, JobType, SbomFormat,
};
use crate::cpe::Cpe;
use crate::error::JobError;
use crate::notify;
use crate::products;
use crate::queue::{self, ClaimedJob};
use crate::sbom_import;
use crate::status;
use crate::trivy::{self, TrivyFinding, TrivyReport};
use crate::version::Version;
use crate::vulns;

#[derive(Debug, Clone, sqlx::FromRow)]
struct ComponentRow {
    id: String,
    source: ComponentSource,
    version: Option<String>,
    purl: Option<String>,
    cpe: Option<String>,
}

/// What a component looked like when we started, to notice an edit made while we worked.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Snapshot {
    version: Option<String>,
    purl: Option<String>,
    cpe: Option<String>,
}

impl From<&ComponentRow> for Snapshot {
    fn from(c: &ComponentRow) -> Self {
        Self {
            version: c.version.clone(),
            purl: c.purl.clone(),
            cpe: c.cpe.clone(),
        }
    }
}

#[derive(Debug)]
struct FindingWrite {
    vulnerability_id: String,
    source: FindingSource,
    fixed_version: Option<String>,
    /// Trivy findings bring their own vulnerability details to store.
    trivy: Option<TrivyFinding>,
}

#[derive(Debug)]
struct Outcome {
    component_id: String,
    snapshot: Snapshot,
    check: ComponentCheck,
    findings: Vec<FindingWrite>,
}

pub async fn run(ctx: &Context, job: &ClaimedJob, payload: &DevicePayload) -> Result<(), JobError> {
    let device_id = payload.device_id.as_str();
    if !device_exists(&ctx.pool, device_id).await? {
        info!("device was deleted, nothing to check");
        return Ok(());
    }

    sbom_import::import_if_pending(&ctx.pool, device_id).await?;
    let components = load_components(&ctx.pool, device_id).await?;

    let mut outcomes = Vec::with_capacity(components.len());
    for component in components
        .iter()
        .filter(|c| c.source == ComponentSource::Manual)
    {
        outcomes.push(check_manual(ctx, component).await?);
    }
    let sbom_components: Vec<&ComponentRow> = components
        .iter()
        .filter(|c| c.source == ComponentSource::Sbom)
        .collect();
    outcomes.extend(check_sbom(ctx, device_id, &sbom_components).await?);

    write_results(&ctx.pool, job, device_id, outcomes, ctx.mailer.is_some()).await
}

async fn device_exists(pool: &PgPool, device_id: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM device WHERE id = $1)")
        .bind(device_id)
        .fetch_one(pool)
        .await
}

async fn load_components(pool: &PgPool, device_id: &str) -> Result<Vec<ComponentRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id, source, version, purl, cpe FROM component WHERE device_id = $1 ORDER BY id",
    )
    .bind(device_id)
    .fetch_all(pool)
    .await
}

fn outcome(
    component: &ComponentRow,
    check: ComponentCheck,
    findings: Vec<FindingWrite>,
) -> Outcome {
    Outcome {
        component_id: component.id.clone(),
        snapshot: Snapshot::from(component),
        check,
        findings,
    }
}

// ---------- Manual product (NVD) ----------

async fn check_manual(ctx: &Context, component: &ComponentRow) -> Result<Outcome, JobError> {
    let Some(cpe_text) = component.cpe.as_deref().filter(|c| !c.is_empty()) else {
        return Ok(outcome(component, ComponentCheck::NoIdentifier, Vec::new()));
    };
    let Some(version_text) = component
        .version
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    else {
        return Ok(outcome(component, ComponentCheck::NoVersion, Vec::new()));
    };
    let Some(version) = Version::parse(version_text) else {
        return Ok(outcome(component, ComponentCheck::BadVersion, Vec::new()));
    };
    let Ok(cpe) = Cpe::parse(cpe_text) else {
        return Ok(outcome(component, ComponentCheck::NoIdentifier, Vec::new()));
    };

    let base = cpe.base();
    products::ensure_fresh(&ctx.pool, &ctx.nvd, &base).await?;
    let matches = products::matches_for(&ctx.pool, &base, &version).await?;
    let findings = matches
        .into_iter()
        .map(|m| FindingWrite {
            vulnerability_id: m.vulnerability_id,
            source: FindingSource::Nvd,
            fixed_version: m.fixed_version,
            trivy: None,
        })
        .collect();
    Ok(outcome(component, ComponentCheck::Checked, findings))
}

// ---------- SBOM components (Trivy) ----------

async fn check_sbom(
    ctx: &Context,
    device_id: &str,
    components: &[&ComponentRow],
) -> Result<Vec<Outcome>, JobError> {
    if components.is_empty() {
        return Ok(Vec::new());
    }
    let has_purl = components.iter().any(|c| c.purl.is_some());
    let report = if has_purl {
        Some(scan_with_trivy(ctx, device_id).await?)
    } else {
        None
    };
    Ok(components
        .iter()
        .map(|c| classify_sbom_component(c, report.as_ref()))
        .collect())
}

/// A component counts as checked only when Trivy listed its package (`--list-all-pkgs`).
fn classify_sbom_component(component: &ComponentRow, report: Option<&TrivyReport>) -> Outcome {
    let Some(purl) = component.purl.as_deref() else {
        // A CPE alone is not something Trivy can use; we do not guess a product from it.
        let check = if component.cpe.is_some() {
            ComponentCheck::Unsupported
        } else {
            ComponentCheck::NoIdentifier
        };
        return outcome(component, check, Vec::new());
    };
    let key = trivy::normalize_purl(purl);
    let understood = report.is_some_and(|r| r.understood.contains(&key));
    if !understood {
        return outcome(component, ComponentCheck::Unsupported, Vec::new());
    }
    let findings = report
        .map(|r| r.findings.iter())
        .into_iter()
        .flatten()
        .filter(|f| f.purl.as_deref() == Some(key.as_str()))
        .map(|f| FindingWrite {
            vulnerability_id: f.vulnerability_id.clone(),
            source: FindingSource::Trivy,
            fixed_version: f.fixed_version.clone(),
            trivy: Some(f.clone()),
        })
        .collect();
    outcome(component, ComponentCheck::Checked, findings)
}

#[derive(sqlx::FromRow)]
struct SbomFile {
    format: SbomFormat,
    content: Vec<u8>,
}

async fn scan_with_trivy(ctx: &Context, device_id: &str) -> Result<TrivyReport, JobError> {
    let file: Option<SbomFile> =
        sqlx::query_as("SELECT format, content FROM sbom WHERE device_id = $1")
            .bind(device_id)
            .fetch_optional(&ctx.pool)
            .await?;
    let Some(file) = file else {
        return Ok(TrivyReport::default());
    };
    // Our own temp directory and file name: nothing from the upload decides the path.
    let dir = tempfile::tempdir().map_err(|e| JobError::Internal(format!("temp dir: {e}")))?;
    let path = dir.path().join(sbom_file_name(file.format));
    tokio::fs::write(&path, &file.content)
        .await
        .map_err(|e| JobError::Internal(format!("write temp file: {e}")))?;
    drop(file);

    match run_trivy(ctx, &path).await {
        Err(JobError::TrivyDbMissing) => {
            ask_for_trivy_db(&ctx.pool).await;
            Err(JobError::TrivyDbMissing)
        }
        other => other,
    }
}

fn sbom_file_name(format: SbomFormat) -> &'static str {
    match format {
        SbomFormat::Cyclonedx => "sbom.cdx.json",
        SbomFormat::Spdx => "sbom.spdx.json",
    }
}

async fn run_trivy(ctx: &Context, path: &Path) -> Result<TrivyReport, JobError> {
    Ok(ctx.trivy.scan_sbom(path).await?)
}

/// Without a database every SBOM check fails; make sure a download is on its way.
async fn ask_for_trivy_db(pool: &PgPool) {
    let queued =
        queue::enqueue_unless_active(pool, JobType::UpdateTrivyDb, serde_json::json!({}), 5, None)
            .await;
    if let Err(err) = queued {
        warn!(error = %err, "could not queue the Trivy database download");
    }
}

// ---------- Writing the result ----------

async fn write_results(
    pool: &PgPool,
    job: &ClaimedJob,
    device_id: &str,
    outcomes: Vec<Outcome>,
    smtp_on: bool,
) -> Result<(), JobError> {
    let mut tx = pool.begin().await?;
    let locked: Option<String> =
        sqlx::query_scalar("SELECT id FROM device WHERE id = $1 FOR UPDATE")
            .bind(device_id)
            .fetch_optional(&mut *tx)
            .await?;
    if locked.is_none() {
        info!("device was deleted during the check, nothing written");
        return Ok(());
    }

    let current = current_snapshots(&mut tx, device_id).await?;
    let mut applied: Vec<&str> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for item in &outcomes {
        // The component was edited or replaced while we worked. A newer check is queued for it.
        if current.get(&item.component_id) != Some(&item.snapshot) {
            warn!(component = %item.component_id, "component changed during the check, skipped");
            continue;
        }
        seen.extend(apply_outcome(&mut tx, device_id, item).await?);
        applied.push(&item.component_id);
    }

    // Findings of the components we just rewrote that this run did not see are gone.
    // Compared by id, not by time: the timestamp columns only keep milliseconds.
    sqlx::query(
        "DELETE FROM finding WHERE device_id = $1 AND component_id = ANY($2::text[]) AND id <> ALL($3::text[])",
    )
    .bind(device_id)
    .bind(&applied)
    .bind(&seen)
    .execute(&mut *tx)
    .await?;

    let summary = status::recompute_device(&mut tx, device_id).await?;
    notify::queue_instant(&mut tx, device_id, smtp_on).await?;
    finish_device(&mut tx, device_id, &job.id).await?;
    tx.commit().await?;
    info!(status = ?summary.status, findings = summary.open_finding_count, "device checked");
    Ok(())
}

async fn current_snapshots(
    tx: &mut sqlx::PgConnection,
    device_id: &str,
) -> Result<std::collections::HashMap<String, Snapshot>, sqlx::Error> {
    let rows: Vec<ComponentRow> =
        sqlx::query_as("SELECT id, source, version, purl, cpe FROM component WHERE device_id = $1")
            .bind(device_id)
            .fetch_all(tx)
            .await?;
    Ok(rows
        .iter()
        .map(|c| (c.id.clone(), Snapshot::from(c)))
        .collect())
}

async fn apply_outcome(
    tx: &mut sqlx::PgConnection,
    device_id: &str,
    item: &Outcome,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query(r#"UPDATE component SET "check" = $2 WHERE id = $1"#)
        .bind(&item.component_id)
        .bind(item.check)
        .execute(&mut *tx)
        .await?;
    let mut ids = Vec::with_capacity(item.findings.len());
    for finding in &item.findings {
        if let Some(details) = &finding.trivy {
            vulns::upsert_trivy(&mut *tx, details).await?;
        }
        let id: String = sqlx::query_scalar(
            "INSERT INTO finding (device_id, component_id, vulnerability_id, source, fixed_version, last_seen_at)
             VALUES ($1, $2, $3, $4, $5, now())
             ON CONFLICT (component_id, vulnerability_id) DO UPDATE SET
               source = EXCLUDED.source, fixed_version = EXCLUDED.fixed_version, last_seen_at = now()
             RETURNING id",
        )
        .bind(device_id)
        .bind(&item.component_id)
        .bind(&finding.vulnerability_id)
        .bind(finding.source)
        .bind(&finding.fixed_version)
        .fetch_one(&mut *tx)
        .await?;
        ids.push(id);
    }
    Ok(ids)
}

/// Marks the check as finished. The device goes back to IDLE only when this job is the one
/// the web app is waiting for; a newer queued check keeps it at CHECKING.
async fn finish_device(
    tx: &mut sqlx::PgConnection,
    device_id: &str,
    job_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE device SET last_checked_at = now(),
           check_state = CASE WHEN check_job_id = $2 THEN 'IDLE'::check_state ELSE check_state END,
           check_error_code = CASE WHEN check_job_id = $2 THEN NULL ELSE check_error_code END
         WHERE id = $1",
    )
    .bind(device_id)
    .bind(job_id)
    .execute(tx)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn component(purl: Option<&str>, cpe: Option<&str>) -> ComponentRow {
        ComponentRow {
            id: "c1".into(),
            source: ComponentSource::Sbom,
            version: Some("1.2.11".into()),
            purl: purl.map(str::to_string),
            cpe: cpe.map(str::to_string),
        }
    }

    fn report() -> TrivyReport {
        trivy::parse_report(include_str!("../../tests/fixtures/trivy/report.json")).unwrap()
    }

    #[test]
    fn a_component_without_purl_or_cpe_has_no_identifier() {
        let out = classify_sbom_component(&component(None, None), None);
        assert_eq!(out.check, ComponentCheck::NoIdentifier);
    }

    #[test]
    fn a_component_with_only_a_cpe_is_not_checked() {
        let out = classify_sbom_component(&component(None, Some("cpe:2.3:a:x:y")), None);
        assert_eq!(out.check, ComponentCheck::Unsupported);
    }

    #[test]
    fn a_package_trivy_does_not_list_is_unsupported_not_clean() {
        let out = classify_sbom_component(
            &component(Some("pkg:generic/openssl@1.1.1k"), None),
            Some(&report()),
        );
        assert_eq!(out.check, ComponentCheck::Unsupported);
        assert!(out.findings.is_empty());
    }

    #[test]
    fn a_listed_package_without_findings_is_checked() {
        let out = classify_sbom_component(
            &component(Some("pkg:generic/zlib@1.2.11?arch=x"), None),
            Some(&report()),
        );
        assert_eq!(out.check, ComponentCheck::Checked);
        assert!(out.findings.is_empty());
    }

    #[test]
    fn findings_are_matched_by_normalized_purl() {
        let purl = "pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1";
        let out = classify_sbom_component(&component(Some(purl), None), Some(&report()));
        assert_eq!(out.check, ComponentCheck::Checked);
        let ids: Vec<_> = out
            .findings
            .iter()
            .map(|f| f.vulnerability_id.as_str())
            .collect();
        assert_eq!(ids, ["CVE-2021-44228", "GHSA-8489-44mv-ggj8"]);
        assert_eq!(out.findings[0].fixed_version.as_deref(), Some("2.15.0"));
    }
}
