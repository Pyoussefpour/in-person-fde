#!/usr/bin/env bash

set -euo pipefail

EMAIL="${ALERT_EMAIL:-parsa@generalmagic.inc}"
WORK="$(mktemp -d)"
cd "$WORK"

cat > pubsub-message-age.json <<'EOF'
{
  "displayName": "Pub/Sub — oldest unacked message age",
  "documentation": {
    "content": "A Pub/Sub subscription has unacknowledged messages older than 10 minutes, indicating consumer lag or a failed subscriber. Check the subscriber service for the affected subscription_id.",
    "mimeType": "text/markdown"
  },
  "combiner": "OR",
  "enabled": true,
  "conditions": [
    {
      "displayName": "Oldest unacked message age above 600s",
      "conditionThreshold": {
        "filter": "resource.type = \"pubsub_subscription\" AND metric.type = \"pubsub.googleapis.com/subscription/oldest_unacked_message_age\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 600,
        "duration": "300s",
        "trigger": { "count": 1 },
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_MAX",
            "crossSeriesReducer": "REDUCE_MAX",
            "groupByFields": ["resource.label.subscription_id"]
          }
        ]
      }
    }
  ],
  "notificationChannels": []
}
EOF

cat > cloudrun-5xx-errors.json <<'EOF'
{
  "displayName": "Cloud Run — 5xx request errors",
  "documentation": {
    "content": "A Cloud Run service is returning server errors. Covers all Cloud Run revisions in the project. Check the affected service_name.",
    "mimeType": "text/markdown"
  },
  "combiner": "OR",
  "enabled": true,
  "conditions": [
    {
      "displayName": "Cloud Run 5xx responses above 5 in 5 minutes",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.label.response_code_class = \"5xx\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 5,
        "duration": "300s",
        "trigger": { "count": 1 },
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_SUM",
            "crossSeriesReducer": "REDUCE_SUM",
            "groupByFields": ["resource.label.service_name"]
          }
        ]
      }
    }
  ],
  "notificationChannels": []
}
EOF

for PROJECT in jadu-prod jadu-qa; do
  echo "==> $PROJECT"
  CHANNEL=$(gcloud alpha monitoring channels list \
    --project="$PROJECT" \
    --filter="type=\"email\" AND labels.email_address=\"$EMAIL\"" \
    --format="value(name)" | head -1)

  if [ -z "$CHANNEL" ]; then
    gcloud alpha monitoring channels create \
      --project="$PROJECT" \
      --display-name="Compliance alerts" \
      --type=email \
      --channel-labels="email_address=$EMAIL" >/dev/null
    CHANNEL=$(gcloud alpha monitoring channels list \
      --project="$PROJECT" \
      --filter="type=\"email\" AND labels.email_address=\"$EMAIL\"" \
      --format="value(name)" | head -1)
  fi
  echo "    channel: $CHANNEL"

  for f in pubsub-message-age cloudrun-5xx-errors; do
    jq --arg ch "$CHANNEL" '.notificationChannels = [$ch]' "$f.json" > "$f-$PROJECT.json"
    gcloud alpha monitoring policies create \
      --project="$PROJECT" \
      --policy-from-file="$f-$PROJECT.json"
  done
done

echo
echo "Verifying:"
for P in jadu-prod jadu-qa; do
  echo "== $P"
  gcloud alpha monitoring policies list --project="$P" --format='table(displayName,enabled)'
done
