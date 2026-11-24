# Gen-Air Worker

A standalone **NestJS 11** server for queue jobs. It follows the backend's familiar
`AppModule`, feature module/controller/service, DTO, environment provider, constants,
interfaces and `TypedLogger` layout. It has its own package, lockfile and Nest config.
There is no database module, database client, backend import or shared source dependency.

The standalone service began with [card 148](https://trello.com/c/irqulidN).
Quotation PDF generation supports the private manual-download HTTP endpoint and
durable `quotation.pdf.v1` broker jobs for lifecycle publication. Both use the same
bounded renderer; the worker never reads the database or writes to Drive.

## Start locally

Node 24 and npm are required. Run commands from this folder:

```sh
npm ci
npm run check

docker compose up --build -d
curl --fail http://localhost:3001/health/ready
RABBITMQ_URL='amqp://worker:local-worker-only@localhost:5672' npm run demo
```

Compose starts an isolated local RabbitMQ 4.1 broker and the worker. All published
ports bind only to localhost. The example credentials are **local-only**. Broker
queues survive container restart in the named volume. `docker compose down` keeps
that data; do not delete the volume while jobs/results need recovery.

To run Nest outside Docker, start only `docker compose up -d rabbitmq`, copy
`.env.example` to `.env`, then run `npm run start:dev`. Production-style local
execution is `npm run build && npm run start:prod`.

- `GET /health/live`: Nest process responds.
- `GET /health/ready`: 200 only while the queue consumer is ready, otherwise 503.
- `POST /render/quotation-pdf`: accepts a saved quotation snapshot from the main
  backend with `Authorization: Bearer <WORKER_API_TOKEN>` and returns PDF bytes.
  Keep this endpoint on a private network. It has no database or Drive access.

## Familiar structure

```text
src/main.ts                         Nest bootstrap and validation pipe
src/app.module.ts                   EnvironmentModule + WorkerModule
src/providers/environment/          ConfigModule and Joi validation
src/modules/worker/                 Controller, queue service, job service
src/dto/job.dto.ts                  Validated versioned message envelope
src/handlers/                     CSV and quotation PDF rendering
src/constants/, interfaces/        Protocol constants and result shapes
src/logger/logger.service.ts        Typed, payload-free structured logging
```

The queue service owns connection, confirms, acknowledgments and shutdown. The
worker service owns job outcomes and retries. The job service runs the pure report
handler in one disposable Node worker thread per queued job, so CPU work does not block
RabbitMQ heartbeats or health checks. This is not another service or dependency.
A timeout terminates the actual thread, rather than merely abandoning a promise.

## Job and result contract

The main server must authorize the request, read the required database rows itself,
create an immutable job snapshot and publish the complete payload. A broker-confirmed
publish means **queued**, not completed. Use the same job ID when a publish outcome
is uncertain; do not change the data associated with an existing job ID.

Job envelope (JSON, maximum 1 MiB):

```json
{
  "version": 1,
  "jobId": "a-unique-job-id",
  "tenantId": "authorized-tenant-id",
  "jobType": "report.csv.v1",
  "attempt": 1,
  "payload": {
    "headers": ["Apartment", "Issue"],
    "rows": [["12", "Missing customer phone"]]
  }
}
```

The CSV handler exports supplied tabular data to CSV. It is inspired by the
backend's apartment import error-report work, but does not replace that XLSX report
or change its business behavior. All cells are strings, every row matches the header
count, and limits are 10,000 rows, 50 columns and 1,000 characters per cell. The JSON
message-size limit applies too. CSV quotes/newlines are escaped and formula-looking
cells get a leading apostrophe, including after leading whitespace.

The terminal result has `version`, `jobId`, `tenantId`, `jobType`, `attempt`,
`completedAt`, `status` (`succeeded` or `failed`), `error` (code or null) and `output`
(`{csv, rowCount, contentType}` or null). CSV result output is capped at 4 MiB. There are
no callbacks, arbitrary reply queues, file-system paths or fetch URLs in a job.

The main server consumes results and owns all database updates, permissions and UI
status. Before acknowledging a result it must validate the contract and tenant/job
match, and transactionally persist the outcome with idempotency keyed by
`(tenantId, jobId)`. Never overwrite an already successful job with a later failure.
If that transaction fails, leave the result unacknowledged for redelivery.
`examples/main-server.mjs` demonstrates only the queue round trip with synthetic
data; printing a result is not a production persistence/idempotency implementation.
Use it only with a dedicated local demo queue prefix, never shared result queues.

## Durable quotation PDF contract

The existing job envelope also accepts `jobType: "quotation.pdf.v1"`. Its `payload`
is `{operationId, cycleId, sourceHash, generation, document}`: bounded identifiers
(1–128 letters/digits/underscores/hyphens), a lowercase SHA-256 source hash, a safe
integer generation of at least 1, and the complete validated `IQuotationPdfPayload`
from `src/interfaces/quotation-pdf.interface.ts`. The backend freezes the document,
including print date and authoritative naming inputs, before publishing. Unknown
outer payload fields and incomplete PDF documents are rejected. The complete job
JSON remains capped at 1 MiB. No client-selected reply queue is accepted.

PDF jobs go only to the fixed `<WORKER_QUEUE_PREFIX>.pdf.jobs` queue, with
a single prefetched delivery per process. Legacy CSV workers never consume it, so
rolling deployments cannot reject PDF jobs as unknown CSV envelopes. PDF results go only to the fixed `<WORKER_QUEUE_PREFIX>.pdf.results` queue. CSV
results retain their existing `.results` queue and exact shape. A valid PDF
terminal result adds top-level
`correlation: {operationId, cycleId, sourceHash, generation}`, including failures.
On success `output` contains that same correlation plus `pdfBase64`,
`contentType: "application/pdf"`, `sha256` (lowercase SHA-256 of decoded bytes)
and `byteLength`. A failed output is null. PDF bytes are capped at 4 MiB and the
serialized PDF result envelope at 6 MiB, accounting for base64 expansion and bounded
metadata; RabbitMQ's message limit must allow at least 6 MiB. Existing RabbitMQ 4.1
default limits support this size. CSV limits do not increase.

The singleton PDF renderer admits one Chromium render across HTTP and broker work
per process. Concurrent HTTP requests return 503; queued work encountering a busy
renderer retries through the existing bounded retry protocol. Each PDF deadline is
110 seconds; expiry kills the actual Chromium child before releasing the slot.
The CSV worker thread retains its 30-second limit. Rendering has no external side
effects and may run again after redelivery; PDF metadata may differ between
renders. The backend must adopt the first matching bytes transactionally before
ACKing the result and never overwrite accepted artifacts with duplicate renders.
The worker does not claim to deduplicate across process restarts or replicas.

## Queue choice and delivery guarantees

RabbitMQ is the initial adapter: it supports durable quorum queues, manual consumer
acks and publisher confirms without giving the worker a database connection. BullMQ
would also be viable but requires Redis; no existing broker was found in the backend.
The versioned JSON contract keeps a future transport change possible.

For prefix `genair.worker.v1` the worker declares:

- `.jobs`: existing durable quorum CSV work queue with manual acknowledgments.
- `.results`: durable quorum CSV result queue consumed by its existing owner.
- `.pdf.jobs`: separate durable quorum PDF work queue with the same retry/dead-letter policy.
- `.pdf.results`: separate durable quorum PDF result queue consumed only by the publication backend.
- `.failures`: durable quorum queue for operator inspection/recovery.

Each queue has a 64 MiB ready-message budget with reject-publish overflow rather
than silent eviction. Size, disk and backlog must be monitored and tuned before a
production rollout. Retention is explicit: no automatic TTL discards jobs or results.
A one-node local broker is persistent, not highly available; production quorum
replication needs a suitable cluster.

Delivery is **at least once**, not exactly once:

1. Success is acknowledged only after the broker confirms a persistent result.
2. Transient execution failures and real type-specific timeouts retry up to three logical
   attempts, with 5- and 10-second delays. Prefetch slots stay occupied during the
   delay, bounding retry load. Validation failures are not retried.
3. A retry is confirmed before the original is acknowledged. A crash between those
   steps can duplicate work; the sample handler has no external side effects.
4. Terminal failures publish a failed result and a failure record before acknowledgment.
   A crash may duplicate these records. Malformed envelopes go only to `.failures`
   with an input hash, not untrusted input or an invented job/tenant ID.
5. Broker/channel/publication failures fail the process after a bounded drain. The
   supervisor restarts it and RabbitMQ redelivers unacknowledged jobs. Connect and
   publish timeouts are 10 seconds; negotiated heartbeat is 30 seconds.
6. RabbitMQ limits repeated unacknowledged delivery of each job message to 10,
   then uses at-least-once dead lettering to `.failures`. These broker-generated
   entries contain the original job and `x-death` headers, not the worker failure
   wrapper. They may have no terminal result; the main server needs stale-job
   reconciliation and operators must monitor this queue. Results/failures have
   no delivery limit to avoid silently discarding them.

SIGTERM cancels consumption, drains active jobs and closes the connection. A single
150-second watchdog covers the whole sequence, including broker RPCs, and forces a
nonzero process exit if it stalls so unfinished deliveries return to the broker. Give the supervisor at
least 180 seconds before forcing termination. No process-local cache claims to prevent
duplicate work across worker replicas. Future handlers must stay pure or supply
idempotency for every external side effect before being enabled.

## Configuration and operations

Set `WORKER_API_TOKEN` to the same random secret in this service and the main
backend. Set the backend's `WORKER_URL` to this service's private base URL. The
runtime image installs Chromium and Noto fonts for A4 Hebrew PDF rendering; the
example Compose file reserves 1 GiB of memory. The backend controls whether the
immutable lifecycle job is published and where accepted bytes are stored in Drive.
Manual HTTP rendering itself only returns bytes and never uploads.

See [the environment migration](migrations/2026-11-10-worker-environment.md) and
[PDF broker rollout](migrations/2026-11-23-quotation-pdf-broker.md).
Production is deliberately not provisioned by this change. Before rollout:

- Use a private broker network, TLS (`amqps`) and separate least-privilege producer,
  worker and result-consumer credentials/vhost. Never reuse Compose credentials.
- Keep health endpoints on a private network. Queue payloads/results/failures can
  contain user data: minimize snapshots, restrict broker access, encrypt transport
  and storage, and define retention/deletion with the application owner.
- Do not pass DB credentials or the main server's secrets to the worker. The image
  runs as a non-root user. Logs contain only status, job ID and attempt, never
  payloads, results, raw broker errors or connection URLs.
- Start with CSV prefetch 1. PDF prefetch stays fixed at 1 independently. Increase
  CSV prefetch only after measuring peak memory/CPU per job.
  Each running job gets a thread with a 128 MiB old-generation limit; that is not
  a complete process-memory cap. Keep container CPU/memory limits too.
- Monitor ready/unacknowledged counts, oldest pending job, failures, retries, result
  backlog, broker disk alarms, restarts and health. Queue metrics come from RabbitMQ;
  no monitoring vendor is configured.
- Inspect failures against the main server's job record. Fix the cause before replay.
  Reuse the immutable job identity and reset attempt only through an authorized
  operator workflow. Do not replay successful jobs or purge queues blindly.
- Existing queues with incompatible arguments cause startup failure. Use a new
  versioned prefix and drain old queues; never silently delete live queues.

## Verification

```sh
npm run check
# Optional real broker test; uses unique disposable queues and removes only those:
TEST_RABBITMQ_URL='amqp://worker:local-worker-only@localhost:5672' npm run test:integration
```

The default tests cover contracts, CSV safety, result/ack ordering, retries and
terminal failures, publisher confirms/nacks/returns, real job-thread execution and
Nest HTTP health. The integration command requires a disposable localhost RabbitMQ
4.1+ broker and fails explicitly if one is not configured. It exercises the real
queue round trip, duplicate output, failure paths and worker readiness during a
2,500-row export. This is not a performance result for the main application.

The maintained integration test uses a disposable localhost RabbitMQ 4.1+ broker
and actual Chromium PDF rendering. It verifies fixed PDF/CSV result routing, byte
hashes, duplicate deliveries, unacknowledged result redelivery and readiness.
Production TLS/ACLs and shared application load remain operational checks; local
broker evidence does not claim production infrastructure verification.

## Next steps

The publication backend owns the durable outbox, first-byte adoption, lifecycle
serialization and Drive reconciliation. Keep worker promotion ahead of enabling
that publisher. Prove normal app responsiveness under representative shared load
before increasing prefetch or renderer concurrency.
