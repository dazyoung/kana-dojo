#!/bin/bash
# Deploy a Kana Dojo release to Google Cloud Run, with accounts and progress in Firestore.
#
#   tools/deploy.sh v1.2.0             test that release, build its image and put it on staging
#   tools/deploy.sh --promote v1.2.0   back up the public site's Firestore, then put the same image there
#
# A release is a git tag (README → Versions and releases). Only what's committed in the tag is used: it's
# exported to a temporary folder, tested there (SQLite, and Firestore in the staging project), and built
# from there. Rolling back is promoting an earlier tag.
#
# Settings: local/gcp.env (see tools/gcp.env.example). One-time setup: tools/gcp-setup.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f local/gcp.env ]; then echo "Copy tools/gcp.env.example to local/gcp.env and fill it in."; exit 1; fi
source local/gcp.env

PROMOTE=0
if [ "${1:-}" = "--promote" ]; then PROMOTE=1; shift; fi
TAG="${1:-}"
if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "Usage: tools/deploy.sh [--promote] v1.2.3"; exit 1; fi
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then echo "There's no tag $TAG (npm version makes them)."; exit 1; fi
VERSION="${TAG#v}"
if [ "$(git show "$TAG:package.json" | node -pe 'JSON.parse(require("fs").readFileSync(0)).version')" != "$VERSION" ]; then
  echo "package.json in $TAG doesn't say $VERSION."; exit 1
fi
IMAGE="$REGION-docker.pkg.dev/$PUBLIC_PROJECT/kana-dojo/app:$VERSION"

deploy() { # project
  local P=$1
  local ENV="KANA_STORE=firestore,TRUST_PROXY=1,GOOGLE_CLOUD_PROJECT=$P,APP_VERSION=$VERSION,KANA_LOG_DAYS=${KANA_LOG_DAYS:-30}"
  if [ -n "${KANA_CONTACT:-}" ]; then ENV="$ENV,KANA_CONTACT=$KANA_CONTACT"; fi
  gcloud run deploy "$SERVICE" --image="$IMAGE" --project="$P" --region="$REGION" \
    --service-account="kana-dojo-run@$P.iam.gserviceaccount.com" --allow-unauthenticated \
    --min-instances=0 --max-instances=3 --cpu=1 --memory=512Mi --concurrency=80 --timeout=60 \
    --set-env-vars="$ENV" --quiet
  local URL GOT
  URL=$(gcloud run services describe "$SERVICE" --project="$P" --region="$REGION" --format='value(status.url)')
  GOT=$(curl -fsS "$URL/api/health" | node -pe 'JSON.parse(require("fs").readFileSync(0)).build')
  if [ "$GOT" != "$VERSION" ]; then echo "$URL says it's running $GOT, not $VERSION."; exit 1; fi
  echo "$URL is running $VERSION."
}

if [ $PROMOTE = 0 ]; then
  SRC=$(mktemp -d)
  trap 'rm -rf "$SRC"' EXIT
  git archive "$TAG" | tar -x -C "$SRC"
  echo "== Testing $TAG: SQLite, and Firestore in $STAGING_PROJECT"
  (cd "$SRC" && node tools/test-firestore.js "$STAGING_PROJECT")
  echo "== Building $IMAGE"
  gcloud builds submit "$SRC" --tag="$IMAGE" --project="$PUBLIC_PROJECT" --quiet
  echo "== Deploying to staging"
  deploy "$STAGING_PROJECT"
  echo "Check it there, then: tools/deploy.sh --promote $TAG"
else
  if ! gcloud artifacts docker images describe "$IMAGE" >/dev/null 2>&1; then
    echo "There's no image for $TAG yet: deploy it to staging first (tools/deploy.sh $TAG)."; exit 1
  fi
  echo "== Backing up the public site's Firestore"
  gcloud firestore export "gs://$PUBLIC_PROJECT-backups/before-$VERSION-$(date -u +%Y%m%d-%H%M%S)" --project="$PUBLIC_PROJECT" --quiet
  echo "== Deploying to the public site"
  deploy "$PUBLIC_PROJECT"
fi
