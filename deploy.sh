#!/usr/bin/env bash
set -euo pipefail

BUCKET="running.jakobthoms.ca"
DISTRIBUTION="E196SDSWC8ECA5"
REGION="us-west-2"
LAMBDA_SESSIONS="running-tracker-sessions"
LAMBDA_AUTH="running-tracker-auth"

REPO_ROOT="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)"

# ── S3 ────────────────────────────────────────────────────────────────────────
echo "Uploading to S3..."

for f in index.html login.html app.js styles.css training-plan-data.js; do
  aws s3 cp "$REPO_ROOT/$f" "s3://$BUCKET/$f" \
    --cache-control "max-age=0, must-revalidate" \
    --region "$REGION"
done

# ── CloudFront invalidation ───────────────────────────────────────────────────
echo "Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION" \
  --paths "/*" \
  --query "Invalidation.{Id:Id,Status:Status}" \
  --output table

# ── Lambda: sessions ──────────────────────────────────────────────────────────
echo "Deploying running-tracker-sessions..."
ZIPFILE_SESSIONS="$REPO_ROOT/sessions.zip"
zip -j "$ZIPFILE_SESSIONS" "$REPO_ROOT/infra/lambda_sessions.py"
aws lambda update-function-code \
  --function-name "$LAMBDA_SESSIONS" \
  --zip-file "fileb://$ZIPFILE_SESSIONS" \
  --region "$REGION" \
  --query '{CodeSize:CodeSize}' \
  --output table
rm "$ZIPFILE_SESSIONS"

# ── Lambda: auth (bcrypt requires pre-built Linux binary in auth_pkg/) ─────────
echo "Deploying running-tracker-auth..."
cp "$REPO_ROOT/infra/lambda_auth.py" "$REPO_ROOT/infra/auth_pkg/lambda_auth.py"
ZIPFILE_AUTH="$REPO_ROOT/auth.zip"
(cd "$REPO_ROOT/infra/auth_pkg" && zip -r "$ZIPFILE_AUTH" . -x "*.pyc" -x "__pycache__/*")
aws lambda update-function-code \
  --function-name "$LAMBDA_AUTH" \
  --zip-file "fileb://$ZIPFILE_AUTH" \
  --region "$REGION" \
  --query '{CodeSize:CodeSize}' \
  --output table
rm "$ZIPFILE_AUTH"

echo ""
echo "Done. CloudFront HTML invalidation takes ~30–60 seconds to propagate."
echo ""
echo "NOTE: running-edge-auth (Lambda@Edge) is NOT deployed by this script."
