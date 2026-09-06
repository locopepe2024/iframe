# Managed COS Storage v1

## Observed

- LumenX currently persists generated media locally and optionally mirrors files to user-configured Alibaba OSS.
- Canvas uses platform-managed private Tencent COS with signed delivery; users do not enter COS credentials.
- LumenX currently has no Tencent COS SDK or managed-storage service contract.

## Decision

- Platform-managed Tencent COS is the default and mandatory durable storage.
- COS credentials, bucket, region, signing policy, quota, and result proxying are server-owned and never exposed in browser settings.
- User-owned Alibaba OSS remains an optional secondary/export destination.
- Local disk is processing scratch space only. A generation is not durable-complete until its result has been admitted to managed COS.

## Settings surface

- API: UniArt API Key, UniArt Base URL, import/sync models.
- Storage: read-only managed COS status and optional user OSS configuration.
- Remove local storage enable/disable, data directory, and log directory controls from the user-facing storage page.

## Runtime contract

`generate -> temporary local file -> managed COS admission -> durable object identity -> signed/proxied URL`

Temporary files may be deleted only after COS admission succeeds. Failure to admit returns a storage failure rather than a local-path success.

## Required server configuration

- managed storage service Base URL and service credential, or
- server-only COS Secret ID/Key, bucket, region, key prefix, and signing TTL.

The first option is preferred because it preserves Canvas quota, ownership, and result-proxy policy.
