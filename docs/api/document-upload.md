# Document upload and private storage — Phase 5 Branch 2

Base URL: `http://localhost:3004`. Every Document route requires an Identity access
JWT (HS256, matching secret/issuer/audience, UUID subject and nonempty session ID).
The subject supplies ownership; request bodies cannot choose an owner or object key.
Cross-owner and deleted resources return 404. Swagger is available at `/docs` when
enabled. Health endpoints remain public.

## Configuration and startup

Use the root `.env` for Compose or `apps/document-service/.env` for direct development;
copy the relevant example and match Identity's JWT settings. Document owns only
`lifehelper_document`. Apply migrations against the intended database, with a backup
for existing data; see [migration guidance](../database/document-migrations.md).

| Variable                                                   | Default / purpose                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `DOCUMENT_S3_BUCKET`                                       | `lifehelper-documents`, dedicated private/versioned bucket                 |
| `AWS_ENDPOINT_URL`                                         | Internal S3 endpoint; Compose uses `http://localstack:4566`                |
| `DOCUMENT_S3_PUBLIC_ENDPOINT`                              | `http://localhost:4566`, endpoint reachable by the uploading client        |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 region/credentials; local examples use disposable test credentials      |
| `DOCUMENT_ALLOWED_EXTENSIONS`                              | `txt,md,pdf`                                                               |
| `DOCUMENT_MAX_FILE_BYTES`                                  | 10485760 (10 MiB), configurable up to 50 MiB                               |
| `DOCUMENT_MAX_STORAGE_BYTES`                               | 104857600 (100 MiB logical reserved bytes per owner)                       |
| `DOCUMENT_MAX_DOCUMENTS`                                   | 100 nondeleted reservations/documents per owner                            |
| `DOCUMENT_UPLOAD_EXPIRY_SECONDS`                           | 300, allowed range 1–900                                                   |
| `DOCUMENT_DOWNLOAD_EXPIRY_SECONDS`                         | 60, allowed range 1–300                                                    |
| `DOCUMENT_STORAGE_TIMEOUT_MS`                              | 10000, total storage deadline including streamed body                      |
| `DOCUMENT_STORAGE_MAX_ATTEMPTS`                            | 2, allowed range 1–3                                                       |
| `DOCUMENT_STORAGE_MAX_CONCURRENT_READS`                    | 2 per service instance, allowed range 1–8; excess verification returns 429 |

Quota includes incomplete reservations until they are deleted/reconciled. It limits
logical declared bytes, not physical bytes of repeated versioned uploads; cleanup of
extra versions arrives in Branch 8. A storage/signing failure releases its reservation.

Fresh Compose starts provision the bucket using
`infrastructure/localstack/init/02-document-storage.sh`, enable versioning and all four
S3 Public Access Block flags, and set a private bucket ACL. An already-running
LocalStack instance needs the new init script executed explicitly:

```bash
docker compose exec localstack sh /etc/localstack/init/ready.d/02-document-storage.sh
pnpm --filter @lifehelper/document-service prisma:generate
pnpm --filter @lifehelper/document-service db:migrate
docker compose up -d --no-deps --build document-service
```

Set `DATABASE_URL` to the intended Document database reachable from the command's
environment. Inside Compose PostgreSQL uses port 5432; host commands use the mapped
`POSTGRES_PORT`. If the running container predates the new bucket environment variable,
pass `DOCUMENT_S3_BUCKET` explicitly to `docker compose exec -e` for provisioning.
Changing the public endpoint requires new signed authorization; rewriting a returned
URL invalidates its signature. Localhost URLs work for host clients; emulator/browser
clients need their own reachable endpoint and, for browsers, explicit bucket CORS.
Do not broaden ACLs to solve CORS.

Community LocalStack 4.8 does not enforce IAM/anonymous GET denial. An unsigned GET
returned 200 even with private settings and `ENFORCE_IAM=1`; IAM enforcement belongs
to supported LocalStack plans ([LocalStack documentation](https://docs.localstack.cloud/aws/developer-tools/security-testing/iam-policy-enforcement/)).
Compose therefore binds its S3 port to 127.0.0.1. Treat it as a local emulator without
real documents or production credentials. Tests verify policy constraints, version
identity, private settings and API ownership; these do not prove anonymous denial.
An IAM-enforcing S3 deployment must deny unsigned reads, public ACLs and public bucket
policies before its privacy gate is complete. No paid provider is required for the
implemented local upload/download flow.

## API contract

| Method / route                        | Result                                                              |
| ------------------------------------- | ------------------------------------------------------------------- |
| `POST /documents/upload-url`          | 201: `{document, upload:{method:"POST",url,fields,expiresAt}}`      |
| `POST /documents/:id/upload-complete` | 200: verified metadata; repeat calls return the committed result    |
| `GET /documents?limit=20`             | 200: owner-only metadata array; limit 1–100                         |
| `GET /documents/:id`                  | 200: owner-only metadata                                            |
| `GET /documents/:id/download-url`     | 200: `{url,expiresAt}`, short-lived URL pinned to committed version |
| `DELETE /documents/:id`               | 204: hidden immediately, cleanup scheduled durably                  |

Upload request: `{filename,mimeType,sizeBytes,checksumSha256?}`. Size must be a positive
integer; optional checksum is 64 lowercase hex characters. TXT requires `text/plain`;
Markdown permits `text/plain` or `text/markdown`; PDF requires `application/pdf`.
Filenames cannot contain path separators/control characters and have a 255-character
limit. Storage uses `users/{owner}/documents/{documentId}/{randomUUID}.{extension}`.

Metadata contains id, originalFilename, mimeType, sizeBytes, status, checksumSha256,
createdAt, updatedAt and uploadExpiresAt. It omits bucket/key/version and provider errors;
the upload/download authorization necessarily identifies its authorized object.
Timestamps are server-generated ISO-8601 UTC backed by TIMESTAMPTZ. No client timezone
or timestamp influences expiry. The POST policy never outlives metadata's deadline.

Completion first checks ownership and expiry, HEADs the object, then streams the
specific immutable version under a size/deadline bound. It verifies actual length,
content type, computes SHA-256 from bytes and checks optional expected checksum.
It never interprets an S3 ETag as SHA-256. Text must be valid UTF-8 without NUL or a
PDF signature. PDF signature validation checks the supported `%PDF-` header only;
full PDF parsing, encryption/scan handling and extraction belong to Branch 4.
Successful completion commits version/checksum once. Reusing the POST before expiry
can create newer versions, but authorized downloads continue reading the committed
bytes. Future processing must GET that committed version and verify its checksum.

Downloads use attachment disposition with a sanitized ASCII fallback and encoded
Unicode filename. Deletion prevents new API access immediately; already-issued signed
URLs remain usable until their short expiry. Final cleanup waits until reusable upload
authorization has expired. A cleanup record is a schedule, not evidence of deletion.

Stable application errors include 400 `DOCUMENT_UPLOAD_INVALID`, 409
`DOCUMENT_QUOTA_EXCEEDED` / `DOCUMENT_NOT_UPLOADED` / upload state conflicts, 410
`DOCUMENT_UPLOAD_EXPIRED`, 404 `DOCUMENT_NOT_FOUND` / `DOCUMENT_OBJECT_MISSING`, 422
size/type/checksum/signature mismatch, 503 `DOCUMENT_BUCKET_UNSAFE` /
`DOCUMENT_STORAGE_UNAVAILABLE`, and 504 `DOCUMENT_STORAGE_TIMEOUT`. Responses include
safe code/message/correlationId. JWT and DTO validation use Nest's 401/400 responses.
`DOCUMENT_STORAGE_BUSY` (429) bounds concurrent buffered verification reads; retry
after in-flight completions finish. This protects memory without an unbounded queue.

## Real file walkthrough

With a current Identity access token exported as `ACCESS_TOKEN`, create a six-byte
UTF-8 file and obtain authorization. The response is sensitive while valid:

```bash
printf 'hello!' > /tmp/document-notes.txt
curl --fail-with-body http://localhost:3004/documents/upload-url \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"filename":"notes.txt","mimeType":"text/plain","sizeBytes":6}' \
  > /tmp/document-upload.json

node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
const proposal = JSON.parse(readFileSync('/tmp/document-upload.json', 'utf8'));
const form = new FormData();
for (const [key, value] of Object.entries(proposal.upload.fields)) form.append(key, value);
form.append('file', new Blob([readFileSync('/tmp/document-notes.txt')]), 'notes.txt');
const result = await fetch(proposal.upload.url, { method: 'POST', body: form });
if (result.status !== 204) throw new Error(`Upload failed: ${result.status}`);
console.log(proposal.document.id);
JS
```

Copy the printed UUID to `DOCUMENT_ID`, then complete and obtain download authorization:

```bash
curl --fail-with-body -X POST "http://localhost:3004/documents/$DOCUMENT_ID/upload-complete" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
curl --fail-with-body "http://localhost:3004/documents/$DOCUMENT_ID/download-url" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > /tmp/document-download.json

node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const { url } = JSON.parse(readFileSync('/tmp/document-download.json', 'utf8'));
const response = await fetch(url);
if (!response.ok) throw new Error(`Download failed: ${response.status}`);
writeFileSync('/tmp/document-downloaded.txt', Buffer.from(await response.arrayBuffer()));
JS
cmp /tmp/document-notes.txt /tmp/document-downloaded.txt
curl --fail-with-body -X DELETE "http://localhost:3004/documents/$DOCUMENT_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Remove the temporary signed-authorization files afterward. No file passes through
the upload API body; multipart upload goes directly to the signed S3 endpoint.

## Verification

Use a dedicated migrated PostgreSQL database ending `_test` or `_ci`; never reset an
application database. The storage suite accepts only localhost/127.0.0.1 S3 endpoints,
creates an isolated versioned bucket, and removes its synthetic owners and versions.

```bash
DATABASE_URL='postgresql://<user>:<password>@localhost:<port>/lifehelper_document_branch2_test' \
  pnpm --filter @lifehelper/document-service db:migrate
DATABASE_URL='postgresql://<user>:<password>@localhost:<port>/lifehelper_document_branch2_test' \
  pnpm --filter @lifehelper/document-service test:persistence
DATABASE_URL='postgresql://<user>:<password>@localhost:<port>/lifehelper_document_branch2_test' \
  pnpm --filter @lifehelper/document-service test:storage
pnpm --filter @lifehelper/document-service lint
pnpm --filter @lifehelper/document-service exec tsc --noEmit -p tsconfig.json
pnpm --filter @lifehelper/document-service test --runInBand
pnpm --filter @lifehelper/document-service test:e2e
pnpm --filter @lifehelper/document-service build
```

`DOCUMENT_STORAGE_TEST_ENDPOINT` overrides the local S3 endpoint (default 4566).
`DOCUMENT_STORAGE_ASSERT_PRIVATE=true` enables the separate anonymous-denial test
only for a local S3 environment that enforces IAM. This test is explicitly skipped in
Community LocalStack; do not report its privacy gate as passed. CI runs the same
PostgreSQL/Community LocalStack workflows and does not need cloud credentials.

Deferred: Branch 3 atomic processing jobs/outbox dispatch, Branch 4 parsing/extraction,
later chunking/embeddings/retrieval/RAG, Branch 8 cleanup worker/reconciliation/audit,
full Flutter screens, OCR, notification delivery, analytics and production deployment.
