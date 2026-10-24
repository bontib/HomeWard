//! Writing global vulnerability rows (shared by all users) and their links to products.

use sqlx::PgConnection;

use crate::nvd_parse::NvdVuln;
use crate::trivy::TrivyFinding;

/// NVD is the richer source, so it always overwrites. `exploited` comes from the KEV table,
/// so the order of KEV import and CVE fetch does not matter.
pub async fn upsert_nvd(conn: &mut PgConnection, v: &NvdVuln) -> Result<(), sqlx::Error> {
    let references = serde_json::json!(v.references);
    sqlx::query(
        "INSERT INTO vulnerability
           (id, severity, cvss_score, cvss_vector, exploited, summary, published_at, modified_at,
            reference_urls, nvd_configurations, details_source, fetched_at)
         VALUES ($1, $2, $3, $4, EXISTS (SELECT 1 FROM kev_entry WHERE cve_id = $1),
                 $5, $6, $7, $8, $9, 'NVD', now())
         ON CONFLICT (id) DO UPDATE SET
           severity = EXCLUDED.severity, cvss_score = EXCLUDED.cvss_score,
           cvss_vector = EXCLUDED.cvss_vector, summary = EXCLUDED.summary,
           published_at = EXCLUDED.published_at, modified_at = EXCLUDED.modified_at,
           reference_urls = EXCLUDED.reference_urls, nvd_configurations = EXCLUDED.nvd_configurations,
           details_source = 'NVD', fetched_at = now()",
    )
    .bind(&v.id)
    .bind(v.severity)
    .bind(v.cvss_score)
    .bind(&v.cvss_vector)
    .bind(&v.summary)
    .bind(v.published_at)
    .bind(v.modified_at)
    .bind(references)
    .bind(&v.configurations)
    .execute(conn)
    .await?;
    Ok(())
}

/// Trivy details never replace what NVD already gave us.
pub async fn upsert_trivy(conn: &mut PgConnection, f: &TrivyFinding) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO vulnerability
           (id, severity, cvss_score, cvss_vector, exploited, summary, published_at, modified_at,
            reference_urls, details_source, fetched_at)
         VALUES ($1, $2, $3, $4, EXISTS (SELECT 1 FROM kev_entry WHERE cve_id = $1),
                 $5, $6, $7, $8, 'TRIVY', now())
         ON CONFLICT (id) DO UPDATE SET
           severity = EXCLUDED.severity, cvss_score = EXCLUDED.cvss_score,
           cvss_vector = EXCLUDED.cvss_vector, summary = EXCLUDED.summary,
           published_at = EXCLUDED.published_at, modified_at = EXCLUDED.modified_at,
           reference_urls = EXCLUDED.reference_urls, fetched_at = now()
         WHERE vulnerability.details_source = 'TRIVY'",
    )
    .bind(&f.vulnerability_id)
    .bind(f.severity)
    .bind(f.cvss_score)
    .bind(&f.cvss_vector)
    .bind(&f.summary)
    .bind(f.published_at)
    .bind(f.modified_at)
    .bind(serde_json::json!(f.references))
    .execute(conn)
    .await?;
    Ok(())
}
