//! SEARCH_PRODUCTS: asks NVD for products matching a text and fills the search cache
//! that `/api/products` reads (ADR 0002).

use crate::context::Context;
use crate::contract::{DataSourceId, SearchProductsPayload};
use crate::data_source;
use crate::error::JobError;

pub async fn run(ctx: &Context, payload: &SearchProductsPayload) -> Result<(), JobError> {
    let found = ctx
        .nvd
        .search_products(&payload.query)
        .await
        .map_err(JobError::from);
    let products = data_source::track(&ctx.pool, DataSourceId::Nvd, found).await?;

    let mut tx = ctx.pool.begin().await?;
    for p in &products {
        sqlx::query(
            "INSERT INTO cpe_product (cpe, part, vendor, product, title, latest_version, fetched_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (cpe) DO UPDATE SET
               title = EXCLUDED.title, latest_version = EXCLUDED.latest_version, fetched_at = now()",
        )
        .bind(&p.cpe)
        .bind(&p.part)
        .bind(&p.vendor)
        .bind(&p.product)
        .bind(&p.title)
        .bind(&p.latest_version)
        .execute(&mut *tx)
        .await?;
    }
    let cpes: Vec<&str> = products.iter().map(|p| p.cpe.as_str()).collect();
    sqlx::query(
        "INSERT INTO product_search (query, status, cpes, fetched_at)
         VALUES ($1, 'READY', $2, now())
         ON CONFLICT (query) DO UPDATE SET status = 'READY', cpes = $2, fetched_at = now()",
    )
    .bind(&payload.query)
    .bind(&cpes)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}
