# Asynchronous script extraction

Observed in production: extraction requests disconnected downstream at approximately 60 seconds (Nginx 499); corresponding upstream Chat calls returned HTTP 200 after approximately 80 seconds. Both proxy layers already allow 3600 seconds. The exact disconnecting network/client component is not proven.

Replace the browser's long-lived extraction request with POST /projects/{id}/extraction-jobs (202) and short GET status requests. Preserve the old synchronous endpoint for older clients. A durable SQLite job record is scoped to owner and project and keyed by exact text, extraction prompt and configured model. Retries/refreshes reuse the same running or completed job rather than executing another provider request. Different input while a project has an active job is rejected. Limit concurrent work; retain completed results for one day. A stale job fails explicitly, never silently reruns. Persist full extraction so apply can reuse results after a restart. Never apply analysis results to a different active project.

Frontend polls short requests, tolerates temporary GET failures, and describes background progress without the fixed 20–60-second claim. Re-entering analysis with unchanged text resumes persisted work. No model/routing changes.

Validation: controlled worker proves immediate return before completion, duplicate submission reuse, owner isolation, durable result reload, input conflicts and failure reporting. Client tests cover short submission/polling and retry behavior. Production acceptance uses a tiny synthetic script; existing user scripts are not overwritten. Deployment preserves data and drains running jobs.
