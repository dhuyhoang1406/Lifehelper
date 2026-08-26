#!/bin/sh
set -eu

awslocal s3api create-bucket \
  --bucket "${S3_BUCKET:-lifehelper-local}" \
  --create-bucket-configuration "LocationConstraint=${AWS_DEFAULT_REGION:-ap-southeast-1}"

DLQ_URL=$(awslocal sqs create-queue \
  --queue-name "${SQS_DLQ_NAME:-lifehelper-events-dlq}" \
  --query QueueUrl --output text)
DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --query Attributes.QueueArn --output text)

awslocal sqs create-queue \
  --queue-name "${SQS_QUEUE_NAME:-lifehelper-events}" \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"}"
