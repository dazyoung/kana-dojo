#!/bin/bash
# One-time Google Cloud setup for Kana Dojo. Run it after creating the project in local/gcp.env and
# linking it to a billing account, with gcloud signed in (gcloud auth login). Safe to run again.
#
# Staging and the public site share the project but nothing else: each has its own Cloud Run service, its
# own Firestore database (public: "(default)", which has the free quota; staging: $STAGING_DATABASE) and its
# own service account, which may only use its own database. Both databases delete expired sign-ins by
# themselves; the public one is backed up daily (kept a week). Also: the registry for release images, a
# bucket for the backups made before each deploy, and a budget alert.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f local/gcp.env ]; then echo "Copy tools/gcp.env.example to local/gcp.env and fill it in."; exit 1; fi
source local/gcp.env
P="$PROJECT"
REPO=kana-dojo
NUMBER=$(gcloud projects describe "$P" --format='value(projectNumber)')

echo "== APIs"
gcloud services enable run.googleapis.com firestore.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com iam.googleapis.com billingbudgets.googleapis.com --project="$P"

echo "== Firestore databases, and the accounts that may use them"
for PAIR in "(default):kana-dojo-run" "$STAGING_DATABASE:kana-dojo-staging-run"; do
  DB=${PAIR%%:*}
  SA=${PAIR#*:}
  if ! gcloud firestore databases describe --database="$DB" --project="$P" >/dev/null 2>&1; then
    gcloud firestore databases create --database="$DB" --location="$REGION" --type=firestore-native --project="$P"
  fi
  gcloud firestore fields ttls update expires --collection-group=sessions --enable-ttl \
    --database="$DB" --project="$P" --quiet >/dev/null
  if ! gcloud iam service-accounts describe "$SA@$P.iam.gserviceaccount.com" --project="$P" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$SA" --display-name="Kana Dojo on Cloud Run ($DB)" --project="$P"
  fi
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$SA@$P.iam.gserviceaccount.com" \
    --role=roles/datastore.user --quiet \
    --condition="expression=resource.name == \"projects/$P/databases/$DB\",title=only-$(echo "$DB" | tr -cd 'a-z0-9-')" >/dev/null
done
if ! gcloud firestore backups schedules list --database='(default)' --project="$P" --format='value(name)' | grep -q .; then
  gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=7d --project="$P"
fi

echo "== Release images"
if ! gcloud artifacts repositories describe "$REPO" --location="$REGION" --project="$P" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION" \
    --description="Kana Dojo releases" --project="$P"
fi
POLICY=$(mktemp)
trap 'rm -f "$POLICY"' EXIT
cat > "$POLICY" <<'EOF'
[{ "name": "keep-10", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 10 } },
 { "name": "delete-older", "action": { "type": "Delete" }, "condition": { "tagState": "any" } }]
EOF
gcloud artifacts repositories set-cleanup-policies "$REPO" --location="$REGION" --policy="$POLICY" \
  --no-dry-run --project="$P" --quiet >/dev/null
# The build runs as the project's default compute account: let it push images and write build logs.
for ROLE in roles/artifactregistry.writer roles/logging.logWriter roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" \
    --role="$ROLE" --condition=None --quiet >/dev/null
done

echo "== Backup bucket"
# Straight to the Cloud Storage API: `gcloud storage` crashes when gcloud runs on Python 3.14.
BUCKET="$P-backups"
TOKEN=$(gcloud auth print-access-token)
API=https://storage.googleapis.com/storage/v1
AUTH=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
EXPIRE='{"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":60}}]}}' # backups kept 60 days
if [ "$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$API/b/$BUCKET")" = 404 ]; then
  curl -fsS -X POST "${AUTH[@]}" "$API/b?project=$P" -d "{\"name\":\"$BUCKET\",\"location\":\"$REGION\",
    \"iamConfiguration\":{\"uniformBucketLevelAccess\":{\"enabled\":true}}}" >/dev/null
fi
curl -fsS -X PATCH "${AUTH[@]}" "$API/b/$BUCKET" -d "$EXPIRE" >/dev/null
# Firestore's own service agent writes the exports (asking for it makes sure it exists).
curl -fsS -X POST "${AUTH[@]}" -d '{}' \
  "https://serviceusage.googleapis.com/v1beta1/projects/$P/services/firestore.googleapis.com:generateServiceIdentity" >/dev/null
MEMBER="serviceAccount:service-$NUMBER@gcp-sa-firestore.iam.gserviceaccount.com"
curl -fsS "${AUTH[@]}" "$API/b/$BUCKET/iam" | MEMBER="$MEMBER" node -e '
  const p = JSON.parse(require("fs").readFileSync(0)); const role = "roles/storage.admin";
  let b = (p.bindings = p.bindings || []).find((x) => x.role === role);
  if (!b) p.bindings.push(b = { role, members: [] });
  if (!b.members.includes(process.env.MEMBER)) b.members.push(process.env.MEMBER);
  process.stdout.write(JSON.stringify(p));' |
  curl -fsS -X PUT "${AUTH[@]}" --data-binary @- "$API/b/$BUCKET/iam" >/dev/null

echo "== Budget alert"
BILLING=$(gcloud billing projects describe "$P" --format='value(billingAccountName)' | sed 's#billingAccounts/##')
if [ -n "$BILLING" ] && ! gcloud billing budgets list --billing-account="$BILLING" --format='value(displayName)' 2>/dev/null | grep -qx 'Kana Dojo'; then
  gcloud billing budgets create --billing-account="$BILLING" --display-name='Kana Dojo' --budget-amount="${BUDGET:-15}" \
    --filter-projects="projects/$P" --threshold-rule=percent=0.33 --threshold-rule=percent=1.0 ||
    echo "Couldn't create the budget alert; add one in the console under Billing → Budgets & alerts."
fi

echo "Done. Next: tools/deploy.sh v<version>"
