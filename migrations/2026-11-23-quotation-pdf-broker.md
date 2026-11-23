# Enable durable quotation PDF rendering

Date: 2026-11-23. Worker protocol and operational configuration only; no database
change. No new application-read variables; Railway requires the platform drain
variable below before deployment.

Deploy this compatible worker before enabling the backend's PDF outbox publisher.
Keep `RABBITMQ_URL` and `WORKER_QUEUE_PREFIX` pointed at the same isolated broker
and prefix as that backend environment. Reuse the existing secret references;
never copy local Compose credentials into a hosted environment.

The worker adds fixed `<prefix>.pdf.jobs` and `<prefix>.pdf.results` durable quorum
queues. PDF publishing and retries use `.pdf.jobs`, while CSV stays on `.jobs`;
old CSV-only replicas cannot consume PDF during rolling deployment.
`WORKER_PREFETCH` continues to control CSV deliveries; PDF prefetch is fixed at 1.
Each process can therefore hold up to `WORKER_PREFETCH + 1` unacknowledged jobs,
with at most one Chromium render across HTTP and PDF jobs. Existing
`<prefix>.jobs`, `.results` and `.failures` declarations remain compatible. Grant
the worker declaration/write access to `.pdf.results` and the backend read access
to that queue, while preserving the existing CSV result owner's access. Backend
PDF consumers must never compete on the CSV `.results` queue. No TTL drops pending
results. Existing per-queue ready-message budget is 64 MiB; monitor backlog/disk.

PDF jobs are capped at 1 MiB JSON. Raw PDFs are capped at 4 MiB and the full result
at 6 MiB, including base64 expansion. Configure RabbitMQ `max_message_size` to at
least 6 MiB if an existing custom limit is lower. No broker limit change is needed
for RabbitMQ 4.1 defaults. Oversized PDFs fail visibly rather than bypassing caps.

A PDF render has a 110-second deadline, separate from CSV's 30 seconds. Both private
HTTP and queue rendering share one bounded Chromium slot per process. The worker
shutdown watchdog is now 150 seconds; give the supervisor at least 180 seconds to
drain. On Railway set **`RAILWAY_DEPLOYMENT_DRAINING_SECONDS=180`** on the
Worker service in each environment before consuming this contract. This required
platform variable is a plain integer number of seconds, not a secret. Railway's
default zero-second termination buffer does not allow graceful PDF draining.
Local Compose's `stop_grace_period` is updated accordingly. Shorter hosted
termination windows can interrupt rendering safely via unacknowledged redelivery,
but do not guarantee graceful completion; configure the hosting drain window where
supported and retain retry/reconciliation observability.

Worker remains database-free and Google-credential-free. A broker confirmation is
not PDF publication. The backend validates result identity/hash/length, adopts the
first matching bytes durably before acknowledgment, and reconciles stale/uncertain
operations including dead-letter exhaustion with no terminal result.

Rollback: disable/drain the backend PDF publisher first. Do not roll back to a
CSV-only worker while PDF jobs remain on their PDF jobs queue; preserve all queues
and publication records for reconciliation. Never purge or rename live queues.
