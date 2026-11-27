#!/bin/bash
# Deploy a Kana Dojo release to Google Cloud Run, with accounts and progress in Firestore.
#
#   tools/deploy.sh v1.2.0             test that release, build its image and put it on staging
#   tools/deploy.sh --promote v1.2.0   back up the public site's Firestore, then put the same image there
#
# A release is a git tag (README → Versions and releases). Only what's committed in the tag is used: it's
# exported to a temporary folder, tested there (SQLite, and the staging Firestore database), and built from
# there. Staging and the public site are separate Cloud Run services in one project, each with its own
# Firestore database and service account. Rolling back is promoting an earlier tag.
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
# Earlier releases can't be told which Firestore database to use, so staging would use the public one.
if ! git show "$TAG:server/server.js" | grep -q KANA_FIRESTORE_DB; then
  echo "$TAG is older than the first release that can run on Google Cloud (0.6.0)."; exit 1
fi
IMAGE="$REGION-docker.pkg.dev/$PROJECT/kana-dojo/app:$VERSION"
json() { node -pe "const j = JSON.parse(require('fs').readFileSync(0)); $1"; }

deploy() { # service database service-account [public-url]
  local SERVICE_NAME=$1 DB=$2 SA=$3 PUBLIC=${4:-}
  # Variables are separated by '|' (gcloud's ^|^ form), since the network list itself has commas.
  local ENV="^|^KANA_STORE=firestore|TRUST_PROXY=1|GOOGLE_CLOUD_PROJECT=$PROJECT|KANA_FIRESTORE_DB=$DB|APP_VERSION=$VERSION"
  ENV="$ENV|KANA_LOG_DAYS=${KANA_LOG_DAYS:-30}"
  if [ -n "${KANA_CONTACT:-}" ]; then ENV="$ENV|KANA_CONTACT=$KANA_CONTACT"; fi
  if [ -n "${KANA_DONATE_URL:-}" ]; then ENV="$ENV|KANA_DONATE_URL=$KANA_DONATE_URL"; fi
  if [ -n "${KANA_PROXY_NETS:-}" ]; then ENV="$ENV|KANA_PROXY_NETS=$KANA_PROXY_NETS"; fi
  if [ -n "$PUBLIC" ]; then ENV="$ENV|KANA_PUBLIC_URL=$PUBLIC"; fi
  gcloud run deploy "$SERVICE_NAME" --image="$IMAGE" --project="$PROJECT" --region="$REGION" \
    --service-account="$SA@$PROJECT.iam.gserviceaccount.com" --allow-unauthenticated \
    --min-instances=0 --max-instances=3 --cpu=1 --memory=512Mi --concurrency=80 --timeout=60 \
    --set-env-vars="$ENV" --quiet
  URL=$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT" --region="$REGION" --format='value(status.url)')
  local GOT CODE
  GOT=$(curl -fsS "$URL/api/health" | json 'j.build')
  if [ "$GOT" != "$VERSION" ]; then echo "$URL says it's running $GOT, not $VERSION."; exit 1; fi
  # An unknown sign-in is looked up in Firestore: 401 means the service can read its database.
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer not-a-real-token-0000000000' "$URL/api/me")
  if [ "$CODE" != 401 ]; then echo "$URL couldn't check a sign-in (HTTP $CODE): see its logs."; exit 1; fi
  echo "$URL is running $VERSION."
}

# Staging only: make an account, sync, and delete it again, as the service itself would.
smoke() {
  local NAME="smoke-$(node -e 'console.log(require("crypto").randomBytes(4).toString("hex"))')"
  local PW; PW=$(node -e 'console.log(require("crypto").randomBytes(12).toString("base64url"))')
  local TOKEN
  TOKEN=$(curl -fsS -H 'Content-Type: application/json' -d "{\"username\":\"$NAME\",\"password\":\"$PW\"}" "$URL/api/signup" | json 'j.token')
  curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"client":99,"progress":{"v":4,"gen":0,"cards":{"あ|read":{"level":1,"due":1,"ok":1,"bad":0,"last":1,"t":1,"at":1}},"log":{}}}' \
    "$URL/api/sync" | json 'if (!j.progress.cards["あ|read"]) throw new Error("sync lost the card"); "synced"' >/dev/null
  curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"password\":\"$PW\"}" "$URL/api/delete-account" >/dev/null
  echo "Made an account on staging, synced it and deleted it."
}

if [ $PROMOTE = 0 ]; then
  SRC=$(mktemp -d)
  trap 'rm -rf "$SRC"' EXIT
  git archive "$TAG" | tar -x -C "$SRC"
  echo "== Testing $TAG: SQLite, and Firestore ($PROJECT/$STAGING_DATABASE)"
  (cd "$SRC" && node tools/test-firestore.js "$PROJECT" "$STAGING_DATABASE")
  echo "== Building $IMAGE"
  gcloud builds submit "$SRC" --tag="$IMAGE" --project="$PROJECT" --quiet
  echo "== Deploying to staging"
  deploy "$STAGING_SERVICE" "$STAGING_DATABASE" kana-dojo-staging-run
  smoke
  echo "Check it at $URL, then: tools/deploy.sh --promote $TAG"
else
  if ! gcloud artifacts docker images describe "$IMAGE" >/dev/null 2>&1; then
    echo "There's no image for $TAG yet: deploy it to staging first (tools/deploy.sh $TAG)."; exit 1
  fi
  echo "== Backing up the public site's Firestore"
  gcloud firestore export "gs://$PROJECT-backups/before-$VERSION-$(date -u +%Y%m%d-%H%M%S)" \
    --database='(default)' --project="$PROJECT" --quiet
  echo "== Deploying to the public site"
  deploy "$SERVICE" '(default)' kana-dojo-run "${FIREBASE_SITE:+https://$FIREBASE_SITE.web.app}"
  if [ -n "${FIREBASE_SITE:-}" ]; then
    GOT=$(curl -fsS "https://$FIREBASE_SITE.web.app/api/health" | json 'j.build')
    if [ "$GOT" != "$VERSION" ]; then echo "https://$FIREBASE_SITE.web.app says it's running $GOT, not $VERSION."; exit 1; fi
    echo "https://$FIREBASE_SITE.web.app is running $VERSION."
  fi
fi
