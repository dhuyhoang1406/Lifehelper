#!/bin/sh
set -eu
bucket="${DOCUMENT_S3_BUCKET:-lifehelper-documents}"
region="${AWS_DEFAULT_REGION:-ap-southeast-1}"
if ! awslocal s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
  if [ "$region" = us-east-1 ]; then
    awslocal s3api create-bucket --bucket "$bucket"
  else
    awslocal s3api create-bucket --bucket "$bucket" --create-bucket-configuration "LocationConstraint=$region"
  fi
fi
awslocal s3api put-bucket-acl --bucket "$bucket" --acl private
awslocal s3api put-bucket-versioning --bucket "$bucket" --versioning-configuration Status=Enabled
awslocal s3api put-public-access-block --bucket "$bucket" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
