#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-validid-governodigital-sandbox}"
REGION="${REGION:-southamerica-east1}"
GKE_CLUSTER="${GKE_CLUSTER:-authid-cluster}"
NAMESPACE="${NAMESPACE:-gov-digital-dev}"
STATIC_IP_NAME="${STATIC_IP_NAME:-backstage-hub-ip}"
MANIFEST_DIR="${MANIFEST_DIR:-infra/kubernetes}"
SKIP_CI_SA="${SKIP_CI_SA:-0}"

CI_SA_NAME="${CI_SA_NAME:-backstage-hub-ci}"
CI_SA_EMAIL="${CI_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
KCTL="kubectl --namespace=${NAMESPACE}"

step() {
  echo
  echo "=============================================================="
  echo ">>> $1"
  echo "=============================================================="
}

step "0. Checking prerequisites"
command -v gcloud >/dev/null || { echo "ERROR: gcloud not installed"; exit 1; }
command -v kubectl >/dev/null || { echo "ERROR: kubectl not installed"; exit 1; }
[ -d "$MANIFEST_DIR" ] || { echo "ERROR: run this from the repo root ($MANIFEST_DIR not found)"; exit 1; }
gcloud config set project "$PROJECT_ID"
echo "Project: $PROJECT_ID | Region: $REGION | Cluster: $GKE_CLUSTER | Namespace: $NAMESPACE"

step "1. Enabling required GCP APIs"
gcloud services enable \
  container.googleapis.com \
  compute.googleapis.com \
  iam.googleapis.com \
  --project "$PROJECT_ID"

step "2. Fetching GKE cluster credentials"
gcloud container clusters get-credentials "$GKE_CLUSTER" \
  --region "$REGION" \
  --project "$PROJECT_ID"

step "3. Creating namespace '$NAMESPACE'"
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

step "4. Reserving global static IP '$STATIC_IP_NAME'"
if gcloud compute addresses describe "$STATIC_IP_NAME" --global --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Static IP already exists."
else
  gcloud compute addresses create "$STATIC_IP_NAME" --global --project "$PROJECT_ID"
fi
INGRESS_IP="$(gcloud compute addresses describe "$STATIC_IP_NAME" --global --project "$PROJECT_ID" --format='value(address)')"
echo "Ingress IP: $INGRESS_IP"
echo ">>> ACTION REQUIRED: point backstage.valid.ia.br to $INGRESS_IP"

step "5. Applying Secret and ConfigMap"
if [ ! -f "$MANIFEST_DIR/secrets.yaml" ]; then
  echo "ERROR: create $MANIFEST_DIR/secrets.yaml from secrets.yaml.example before deploying."
  exit 1
fi
$KCTL apply -f "$MANIFEST_DIR/secrets.yaml"
$KCTL apply -f "$MANIFEST_DIR/configmap.yaml"

step "6. Deploying PostgreSQL"
$KCTL apply -f "$MANIFEST_DIR/postgres-deployment.yaml"
$KCTL rollout status deployment/backstage-hub-postgres --timeout=300s

step "7. Deploying Backstage"
$KCTL apply -f "$MANIFEST_DIR/backend-deployment.yaml"
$KCTL rollout status deployment/backstage-hub --timeout=300s

step "8. Applying Ingress, ManagedCertificate and HPA"
$KCTL apply -f "$MANIFEST_DIR/ingress.yaml"
$KCTL apply -f "$MANIFEST_DIR/hpa.yaml"

if [ "$SKIP_CI_SA" != "1" ]; then
  step "9. Creating CI service account for GitHub Actions"
  if gcloud iam service-accounts describe "$CI_SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "Service account already exists."
  else
    gcloud iam service-accounts create "$CI_SA_NAME" \
      --display-name="Backstage Hub CI/CD" \
      --project "$PROJECT_ID"
  fi
  for ROLE in roles/container.developer roles/storage.admin; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:${CI_SA_EMAIL}" \
      --role="$ROLE" \
      --condition=None \
      --quiet
  done
  gcloud iam service-accounts keys create gcp-sa-key.json \
    --iam-account="$CI_SA_EMAIL" \
    --project "$PROJECT_ID"
  echo ">>> ACTION REQUIRED: add gcp-sa-key.json contents as GitHub secret GCP_SA_KEY, then delete the local file."
else
  step "9. Skipping CI service account"
fi

step "Done"
$KCTL get pods,svc,ingress,hpa
echo
echo "Ingress IP: $INGRESS_IP"
echo "Backstage : https://backstage.valid.ia.br"
