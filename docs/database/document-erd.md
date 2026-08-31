# Document database

```text
Document 1 ── * DocumentChunk 1 ── 0..1 DocumentEmbedding
```

Children cascade with the document/chunk. `s3Key` and `(documentId, chunkIndex)` are unique. PostgreSQL `vector` is enabled for embeddings. User/status indexes support document lists; size, chunk index, token count and outbox attempts have checks. `userId` is only a logical cross-service reference.
