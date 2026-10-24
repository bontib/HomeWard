//! The product cache: which CVEs NVD lists for a product (without version), and which
//! of them hit a given version.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use tracing::warn;

use crate::contract::DataSourceId;
use crate::cpe::{match_configurations, Cpe};
use crate::data_source;
use crate::error::JobError;
use crate::nvd::NvdClient;
use crate::version::Version;
use crate::vulns;

/// How long a product's CVE list counts as fresh. One day, so the daily rescan sees new CVEs.
pub const CVE_CACHE_HOURS: i64 = 24;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    pub vulnerability_id: String,
    pub fixed_version: Option<String>,
}

pub fn is_stale(fetched_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    fetched_at.is_none_or(|t| now - t >= chrono::Duration::hours(CVE_CACHE_HOURS))
}

/// Makes sure the product's CVE list is cached and fresh enough. When NVD cannot be reached
/// the old list is used if there is one (and `data_source` shows the failure); with no list
/// at all the error goes up and the job is retried later.
pub async fn ensure_fresh(pool: &PgPool, nvd: &NvdClient, base_cpe: &str) -> Result<(), JobError> {
    let cpe = Cpe::parse(base_cpe).map_err(|e| JobError::Internal(e.to_string()))?;
    let fetched_at = product_fetched_at(pool, &cpe).await?;
    if !is_stale(fetched_at, Utc::now()) {
        return Ok(());
    }
    let fetched = nvd.cves_for_product(base_cpe).await.map_err(JobError::from);
    match data_source::track(pool, DataSourceId::Nvd, fetched).await {
        Ok(vulns) => store_cves(pool, &cpe, &vulns).await,
        Err(err) if fetched_at.is_some() => {
            warn!(cpe = base_cpe, error = %err, "NVD unavailable, using the cached CVE list");
            Ok(())
        }
        Err(err) => Err(err),
    }
}

async fn product_fetched_at(
    pool: &PgPool,
    cpe: &Cpe,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    // A product picked from search is already cached; one created another way gets a plain row.
    sqlx::query(
        "INSERT INTO cpe_product (cpe, part, vendor, product, title, fetched_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (cpe) DO NOTHING",
    )
    .bind(cpe.base())
    .bind(&cpe.part)
    .bind(&cpe.vendor)
    .bind(&cpe.product)
    .bind(format!("{} {}", cpe.vendor, cpe.product).replace('_', " "))
    .execute(pool)
    .await?;
    sqlx::query_scalar("SELECT cves_fetched_at::timestamptz FROM cpe_product WHERE cpe = $1")
        .bind(cpe.base())
        .fetch_one(pool)
        .await
}

async fn store_cves(
    pool: &PgPool,
    cpe: &Cpe,
    found: &[crate::nvd_parse::NvdVuln],
) -> Result<(), JobError> {
    let mut tx = pool.begin().await?;
    for vuln in found {
        vulns::upsert_nvd(&mut tx, vuln).await?;
    }
    let ids: Vec<&str> = found.iter().map(|v| v.id.as_str()).collect();
    sqlx::query(
        "INSERT INTO cpe_product_cve (cpe, vulnerability_id)
         SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING",
    )
    .bind(cpe.base())
    .bind(&ids)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM cpe_product_cve WHERE cpe = $1 AND vulnerability_id <> ALL($2::text[])",
    )
    .bind(cpe.base())
    .bind(&ids)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE cpe_product SET cves_fetched_at = now() WHERE cpe = $1")
        .bind(cpe.base())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// The cached CVEs of a product that hit this version.
pub async fn matches_for(
    pool: &PgPool,
    base_cpe: &str,
    version: &Version,
) -> Result<Vec<Match>, sqlx::Error> {
    let rows: Vec<(String, Option<serde_json::Value>)> = sqlx::query_as(
        "SELECT v.id, v.nvd_configurations
         FROM cpe_product_cve pc JOIN vulnerability v ON v.id = pc.vulnerability_id
         WHERE pc.cpe = $1 ORDER BY v.id",
    )
    .bind(base_cpe)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, configurations)| {
            let affected = match_configurations(&configurations?, base_cpe, version)?;
            Some(Match {
                vulnerability_id: id,
                fixed_version: affected.fixed_version,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_list_never_fetched_is_stale() {
        assert!(is_stale(None, Utc::now()));
    }

    #[test]
    fn a_list_from_an_hour_ago_is_fresh() {
        let now = Utc::now();
        assert!(!is_stale(Some(now - chrono::Duration::hours(1)), now));
    }

    #[test]
    fn a_list_from_a_day_ago_is_stale() {
        let now = Utc::now();
        assert!(is_stale(Some(now - chrono::Duration::hours(25)), now));
    }
}
