#!/bin/bash
# One-time Google Cloud setup for Kana Dojo. Run it after creating the two projects in local/gcp.env
# (staging and public) and linking them to a billing account, with gcloud signed in (gcloud auth login).
# Safe to run again.
#
# In each project: the APIs, a Firestore database in $REGION (with old sign-ins deleted automatically and
# daily backups kept a week), and a service account the app runs as, which may only use Firestore.
# In the public project: the registry for release images (staging may pull from it), a bucket for
# backups made before each deploy, and a budget alert.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f local/gcp.env ]; then echo "Copy tools/gcp.env.example to local/gcp.env and fill it in."; exit 1; fi
source local/gcp.env
REPO=kana-dojo
RUNNER=kana-dojo-run

for P in "$STAGING_PROJECT" "$PUBLIC_PROJECT"; do
  echo "== $P"
  gcloud services enable run.googleapis.com firestore.googleapis.com artifactregistry.googleapis.com \
    cloudbuild.googleapis.com iam.googleapis.com --project "$P"

  if ! gcloud firestore databases describe --database='(default)' --project "$P" >/dev/null 2>&1; then
    gcloud firestore databases create --database='(default)' --location="$REGION" --type=firestore-native --project "$P"
  fi
  gcloud firestore fields ttls update expires --collection-group=sessions --enable-ttl --project "$P" --quiet >/dev/null
  if ! gcloud firestore backups schedules list --database='(default)' --project "$P" --format='value(name)' | grep -q .; then
    gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=7d --project "$P"
  fi

  if ! gcloud iam service-accounts describe "$RUNNER@$P.iam.gserviceaccount.com" --project "$P" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$RUNNER" --display-name="Kana Dojo on Cloud Run" --project "$P"
  fi
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$RUNNER@$P.iam.gserviceaccount.com" \
    --role=roles/datastore.user --condition=None --quiet >/dev/null
done

echo "== Release images ($PUBLIC_PROJECT)"
if ! gcloud artifacts repositories describe "$REPO" --location="$REGION" --project "$PUBLIC_PROJECT" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION" \
    --description="Kana Dojo releases" --project "$PUBLIC_PROJECT"
fi
POLICY=$(mktemp); trap 'rm -f "$POLICY"' EXIT
cat > "$POLICY" <<'EOF'
[{ "name": "keep-10", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 10 } },
 { "name": "delete-older", "action": { "type": "Delete" }, "condition": { "tagState": "any" } }]
EOF
gcloud artifacts repositories set-cleanup-policies "$REPO" --location="$REGION" --policy="$POLICY" \
  --no-dry-run --project "$PUBLIC_PROJECT" --quiet >/dev/null
STAGING_NUMBER=$(gcloud projects describe "$STAGING_PROJECT" --format='value(projectNumber)')
PUBLIC_NUMBER=$(gcloud projects describe "$PUBLIC_PROJECT" --format='value(projectNumber)')
# Staging's Cloud Run may pull the images; the build (as the public project's default account) may push them.
gcloud artifacts repositories add-iam-policy-binding "$REPO" --location="$REGION" --project "$PUBLIC_PROJECT" \
  --member="serviceAccount:service-$STAGING_NUMBER@serverless-robot-prod.iam.gserviceaccount.com" \
  --role=roles/artifactregistry.reader --quiet >/dev/null
for ROLE in roles/artifactregistry.writer roles/logging.logWriter roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$PUBLIC_PROJECT" --member="serviceAccount:$PUBLIC_NUMBER-compute@developer.gserviceaccount.com" \
    --role="$ROLE" --condition=None --quiet >/dev/null
done

echo "== Backup bucket"
BUCKET="gs://$PUBLIC_PROJECT-backups"
if ! gcloud storage buckets describe "$BUCKET" --project "$PUBLIC_PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "$BUCKET" --location="$REGION" --uniform-bucket-level-access --project "$PUBLIC_PROJECT"
fi
LIFECYCLE=$(mktemp)
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":60}}]}' > "$LIFECYCLE"
gcloud storage buckets update "$BUCKET" --lifecycle-file="$LIFECYCLE" --project "$PUBLIC_PROJECT" >/dev/null
rm -f "$LIFECYCLE"
# Firestore's own service agent (made when the database was created) writes the exports.
gcloud storage buckets add-iam-policy-binding "$BUCKET" \
  --member="serviceAccount:service-$PUBLIC_NUMBER@gcp-sa-firestore.iam.gserviceaccount.com" \
  --role=roles/storage.admin --project "$PUBLIC_PROJECT" >/dev/null

echo "== Budget alert"
BILLING=$(gcloud billing projects describe "$PUBLIC_PROJECT" --format='value(billingAccountName)' | sed 's#billingAccounts/##')
if [ -n "$BILLING" ] && ! gcloud billing budgets list --billing-account="$BILLING" --format='value(displayName)' 2>/dev/null | grep -qx 'Kana Dojo'; then
  gcloud billing budgets create --billing-account="$BILLING" --display-name='Kana Dojo' --budget-amount="${BUDGET:-15}" \
    --filter-projects="projects/$STAGING_PROJECT,projects/$PUBLIC_PROJECT" \
    --threshold-rule=percent=0.33 --threshold-rule=percent=1.0 ||
    echo "Couldn't create the budget alert; add one in the console under Billing → Budgets & alerts."
fi

echo "Done. Next: tools/deploy.sh v<version>"
