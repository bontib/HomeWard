//! Turns an uploaded SBOM file into `component` rows (step 1 of CHECK_DEVICE).
//! A new upload keeps the rows of components that are still in the file, so their
//! findings (and any "ignored" decision) survive.

use std::collections::HashMap;

use sqlx::PgPool;

use crate::contract::SbomFormat;
use crate::error::JobError;
use crate::sbom::{self, SbomComponent};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct Key {
    name: String,
    version: Option<String>,
    purl: Option<String>,
    cpe: Option<String>,
}

impl From<&SbomComponent> for Key {
    fn from(c: &SbomComponent) -> Self {
        Self {
            name: c.name.clone(),
            version: c.version.clone(),
            purl: c.purl.clone(),
            cpe: c.cpe.clone(),
        }
    }
}

#[derive(Debug, sqlx::FromRow)]
struct ExistingRow {
    id: String,
    name: String,
    version: Option<String>,
    purl: Option<String>,
    cpe: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Diff<'a> {
    pub delete_ids: Vec<String>,
    pub insert: Vec<&'a SbomComponent>,
}

fn diff<'a>(existing: &[ExistingRow], parsed: &'a [SbomComponent]) -> Diff<'a> {
    let mut present: HashMap<Key, &str> = HashMap::new();
    for row in existing {
        let key = Key {
            name: row.name.clone(),
            version: row.version.clone(),
            purl: row.purl.clone(),
            cpe: row.cpe.clone(),
        };
        present.insert(key, row.id.as_str());
    }
    let wanted: std::collections::HashSet<Key> = parsed.iter().map(Key::from).collect();
    let delete_ids = existing
        .iter()
        .filter(|row| {
            let key = Key {
                name: row.name.clone(),
                version: row.version.clone(),
                purl: row.purl.clone(),
                cpe: row.cpe.clone(),
            };
            !wanted.contains(&key)
        })
        .map(|row| row.id.clone())
        .collect();
    let insert = parsed
        .iter()
        .filter(|c| !present.contains_key(&Key::from(*c)))
        .collect();
    Diff { delete_ids, insert }
}

#[derive(sqlx::FromRow)]
struct PendingSbom {
    id: String,
    format: SbomFormat,
    content: Vec<u8>,
}

/// Parses the device's SBOM when it has not been parsed yet. Safe to run twice.
pub async fn import_if_pending(pool: &PgPool, device_id: &str) -> Result<(), JobError> {
    let pending: Option<PendingSbom> = sqlx::query_as(
        "SELECT id, format, content FROM sbom WHERE device_id = $1 AND parsed_at IS NULL",
    )
    .bind(device_id)
    .fetch_optional(pool)
    .await?;
    let Some(sbom_row) = pending else {
        return Ok(());
    };

    let PendingSbom {
        id,
        format,
        content,
    } = sbom_row;
    // Parsing up to 100 MB of JSON is CPU work; keep it off the async threads.
    let parsed = tokio::task::spawn_blocking(move || sbom::parse(format, &content))
        .await
        .map_err(|e| JobError::Internal(format!("SBOM parser stopped: {e}")))??;

    let mut tx = pool.begin().await?;
    let locked: Option<String> =
        sqlx::query_scalar("SELECT id FROM device WHERE id = $1 FOR UPDATE")
            .bind(device_id)
            .fetch_optional(&mut *tx)
            .await?;
    if locked.is_none() {
        return Ok(());
    }
    // A newer upload may have replaced the file while we parsed; then it will be parsed by its own job.
    let still_pending: Option<String> =
        sqlx::query_scalar("SELECT id FROM sbom WHERE id = $1 AND parsed_at IS NULL")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?;
    if still_pending.is_none() {
        return Ok(());
    }

    let existing: Vec<ExistingRow> = sqlx::query_as(
        "SELECT id, name, version, purl, cpe FROM component WHERE device_id = $1 AND source = 'SBOM'",
    )
    .bind(device_id)
    .fetch_all(&mut *tx)
    .await?;
    let changes = diff(&existing, &parsed);

    sqlx::query("DELETE FROM component WHERE id = ANY($1::text[])")
        .bind(&changes.delete_ids)
        .execute(&mut *tx)
        .await?;
    insert_components(&mut tx, device_id, &changes.insert).await?;
    sqlx::query("UPDATE sbom SET parsed_at = now() WHERE id = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

async fn insert_components(
    tx: &mut sqlx::PgConnection,
    device_id: &str,
    components: &[&SbomComponent],
) -> Result<(), sqlx::Error> {
    let names: Vec<&str> = components.iter().map(|c| c.name.as_str()).collect();
    let versions: Vec<Option<&str>> = components.iter().map(|c| c.version.as_deref()).collect();
    let vendors: Vec<Option<&str>> = components.iter().map(|c| c.vendor.as_deref()).collect();
    let purls: Vec<Option<&str>> = components.iter().map(|c| c.purl.as_deref()).collect();
    let cpes: Vec<Option<&str>> = components.iter().map(|c| c.cpe.as_deref()).collect();
    sqlx::query(
        "INSERT INTO component (device_id, source, name, version, vendor, purl, cpe)
         SELECT $1, 'SBOM', n, v, ven, p, c
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) AS t(n, v, ven, p, c)",
    )
    .bind(device_id)
    .bind(&names)
    .bind(&versions)
    .bind(&vendors)
    .bind(&purls)
    .bind(&cpes)
    .execute(tx)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(name: &str, version: &str) -> SbomComponent {
        SbomComponent {
            name: name.into(),
            version: Some(version.into()),
            vendor: None,
            purl: Some(format!("pkg:generic/{name}@{version}")),
            cpe: None,
        }
    }

    fn existing(id: &str, name: &str, version: &str) -> ExistingRow {
        ExistingRow {
            id: id.into(),
            name: name.into(),
            version: Some(version.into()),
            purl: Some(format!("pkg:generic/{name}@{version}")),
            cpe: None,
        }
    }

    #[test]
    fn unchanged_components_are_kept() {
        let rows = [existing("1", "zlib", "1.2.11")];
        let new = [parsed("zlib", "1.2.11")];
        let d = diff(&rows, &new);
        assert!(d.delete_ids.is_empty());
        assert!(d.insert.is_empty());
    }

    #[test]
    fn a_new_version_replaces_the_old_row() {
        let rows = [existing("1", "zlib", "1.2.11")];
        let new = [parsed("zlib", "1.3.0")];
        let d = diff(&rows, &new);
        assert_eq!(d.delete_ids, ["1"]);
        assert_eq!(d.insert.len(), 1);
    }

    #[test]
    fn removed_components_are_deleted_and_new_ones_added() {
        let rows = [existing("1", "a", "1"), existing("2", "b", "1")];
        let new = [parsed("b", "1"), parsed("c", "1")];
        let d = diff(&rows, &new);
        assert_eq!(d.delete_ids, ["1"]);
        assert_eq!(d.insert[0].name, "c");
    }
}
