#!/bin/sh
# Stand-in for the trivy binary in tests. Never touches the network.
#   trivy sbom ...                      prints tests/fixtures/trivy/report.json
#   trivy image --download-db-only ...  creates <cache-dir>/db/{trivy.db,metadata.json}
here="$(cd "$(dirname "$0")" && pwd)"
case "$1" in
  sbom)
    cat "$here/trivy/report.json"
    ;;
  image)
    cache=""
    while [ $# -gt 0 ]; do
      if [ "$1" = "--cache-dir" ]; then cache="$2"; fi
      shift
    done
    mkdir -p "$cache/db"
    echo fake-db > "$cache/db/trivy.db"
    cp "$here/trivy/metadata.json" "$cache/db/metadata.json"
    ;;
  *)
    echo "fake-trivy: unexpected arguments" >&2
    exit 2
    ;;
esac
