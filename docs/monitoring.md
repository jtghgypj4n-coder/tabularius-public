# Monitoring

Tabularius provides a public health check and an admin-only Prometheus endpoint.
See [Monitoring in the admin guide](../ADMIN.md#monitoring) for the log location.

## Health check

`GET /tabularius/health` needs no sign-in. While the server is serving, it returns
HTTP 200 with `Content-Type: application/json; charset=utf-8` and
`Cache-Control: no-store`:

```json
{"status":"ok","uptimeSeconds":123,"serverTime":"2026-01-01T00:00:00.000Z"}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | string | Always `"ok"` when the handler answers. |
| `uptimeSeconds` | number | Seconds since this process's metrics instance started, rounded to the nearest second. |
| `serverTime` | string | The server's clock as an ISO 8601 UTC time, so the browser self-check can estimate the difference from the browser's clock. Added with the self-check page; it is also given to callers who are not signed in. |

This is a liveness check. It does not inspect hosted files, backup results, disk
space or database readiness, and it discloses no file information.

## Metrics access and scraping

`GET /tabularius/admin/v1/metrics` returns Prometheus text format 0.0.4 with
`Content-Type: text/plain; version=0.0.4; charset=utf-8` and
`Cache-Control: no-store`. Use this path explicitly; it is not `/metrics`.

The endpoint uses the admin console's access check:

- Set the admin password with `tabularius admin-password <folder>`. HTTP Basic
  accepts any username and requires that password. Missing or incorrect
  credentials return 401; repeated failures can return 429 with `Retry-After`.
- An authenticated admin console cookie or the local admin channel's
  `x-tabularius-local` token also grants access.
- Without an admin password, access is limited to direct loopback requests
  addressed to localhost or a loopback host. Forwarded requests are refused,
  even when the proxy connects over loopback; denied access returns 403.

Prometheus needs no `x-tabularius-admin` header for this GET. Use HTTPS when
scraping over the network: Basic credentials carry the admin password, and
metrics include hosted file names, schedule names and standby addresses.

Add this to `prometheus.yml`, replacing the target with the server's HTTPS
address. Put the admin password in a file readable by Prometheus; the
`password_file` path is on the Prometheus host or inside its container.

```yaml
scrape_configs:
  - job_name: tabularius
    scheme: https
    metrics_path: /tabularius/admin/v1/metrics
    scrape_interval: 30s
    basic_auth:
      username: prometheus
      password_file: /etc/prometheus/secrets/tabularius-admin-password
    static_configs:
      - targets: ['files.example.com:443']
```

## Metric reference

These are the metric families emitted by `Metrics.render()` in
[`packages/server/src/metrics.ts`](../packages/server/src/metrics.ts).
Labels below are those emitted by the server; Prometheus adds target labels
such as `job` and `instance`. “None” means no server-supplied labels.
Timestamps are Unix seconds. Counters are held in memory and reset on restart.

### Availability and HTTP traffic

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `tabularius_up` | gauge | None | Always 1 when metrics are rendered. An unreachable server cannot emit 0; use Prometheus's `up` for scrape failures. |
| `tabularius_build_info` | gauge | `version` | Always 1; the label is the server version that is running. |
| `tabularius_start_time_seconds` | gauge | None | Time this process's metrics instance started. |
| `tabularius_http_requests_total` | counter | `route`, `method`, `status` | Finished HTTP requests, including streams when they finish. `status` is a class such as `2xx`, `4xx` or `5xx`; `method` is the HTTP method. |
| `tabularius_http_request_duration_seconds` | histogram | `route`; buckets also have `le` | Time to answer requests in seconds, excluding event streams and `/changes` long polls. |

`route` groups requests into a fixed set: `admin`, `adminapi`, `app`,
`assistant`, `auth`, `containers`, `dataapi`, `debug`, `design`, `health`,
`images`, `live`, `mcp`, `odata`, `other`, `replication`, `root`, `sql` and
`xml`. It never contains individual record IDs or request paths.

The histogram emits `tabularius_http_request_duration_seconds_bucket` with
cumulative upper bounds (`le`) of 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1,
2.5, 5, 10 and `+Inf` seconds, plus
`tabularius_http_request_duration_seconds_sum` and
`tabularius_http_request_duration_seconds_count`. HTTP series appear after
requests finish. In a cluster, request counts and durations add the workers'
reported values; process metrics describe the process answering the scrape.

### Hosted files and activity

These families require the server's metric sources to be attached. Per-file
series exist only for hosted files; `file` is the hosted name.

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `tabularius_files` | gauge | None | Number of hosted files. |
| `tabularius_file_size_bytes` | gauge | `file` | Hosted SQLite file size plus its write-ahead log, in bytes. A file that cannot be statted contributes 0. This is not free disk space. |
| `tabularius_disk_free_bytes` | gauge | `area` | Free disk space, in bytes, for this user where the hosted files (`data`) and the backups (`backups`) are kept. A series is left out when the system does not report free space (some network and virtual file systems). |
| `tabularius_sessions` | gauge | `file` | Signed-in web client and Data API sessions for each hosted file. |
| `tabularius_record_locks` | gauge | `file` | Records currently locked for editing in each hosted file. |
| `tabularius_live_streams` | gauge | None | Open live-update streams. |
| `tabularius_server_scripts_running` | gauge | None | Running server-side scripts, including Perform Script on Server and schedules. |
| `tabularius_server_scripts_queued` | gauge | None | Server-side scripts waiting for a turn. |
| `tabularius_sessions_held` | gauge | None | Sessions retained in memory, including timed-out sessions not yet swept. Only emitted when that source is supplied. | <!-- known-difference-ok: "not yet swept" describes timed-out sessions held in memory, not a difference from FileMaker -->
| `tabularius_postgresql_connections` | gauge | None | Open PostgreSQL-protocol connections. Only emitted when that source is supplied. |

### Backups

Each pair appears only after that backup source has a last-run result. Missing
series do not mean a successful run. These are last-outcome gauges, not failure
counters; a later success clears a failure indication.

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `tabularius_backup_last_run_timestamp_seconds` | gauge | None | Time of the last scheduled backup. |
| `tabularius_backup_last_run_ok` | gauge | None | 1 if the last scheduled backup succeeded, 0 if it failed. |
| `tabularius_progressive_backup_last_run_timestamp_seconds` | gauge | None | Time of the last progressive backup. |
| `tabularius_progressive_backup_last_run_ok` | gauge | None | 1 if the last progressive backup succeeded, 0 if it failed. |
| `tabularius_offsite_backup_last_run_timestamp_seconds` | gauge | None | Time of the last off-site copy. |
| `tabularius_offsite_backup_last_run_ok` | gauge | None | 1 if the last off-site copy succeeded, 0 if it failed. |

### Script schedules, certificates and standbys

Schedule families appear when schedules exist. `schedule` is the schedule name
and `id` its identifier. Next-run samples require a next-run time; last-run and
last-error samples require a previous run. Standby families appear only when
standbys are reported. `standby` is the address plus a per-process identifier
and `file` is the file name. The lag is measured from the last sequence the
standby acknowledged, so downloading a response alone does not reduce it.

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `tabularius_schedule_enabled` | gauge | `schedule`, `id` | 1 if enabled, 0 if disabled. |
| `tabularius_schedule_next_run_timestamp_seconds` | gauge | `schedule`, `id` | Time of the next scheduled run. |
| `tabularius_schedule_last_run_timestamp_seconds` | gauge | `schedule`, `id` | Time of the last run. |
| `tabularius_schedule_last_error` | gauge | `schedule`, `id` | Last run's FileMaker error code: 0 means no error. This is an error code, not a count or rate. |
| `tabularius_schedule_runs_total` | counter | `schedule`, `id` | Runs since server startup. |
| `tabularius_schedule_failures_total` | counter | `schedule`, `id` | Runs ending with an error since server startup. |
| `tabularius_certificate_expiry_timestamp_seconds` | gauge | None | HTTPS certificate expiry time. The family has no sample when expiry is unavailable. |
| `tabularius_standby_behind` | gauge | `standby`, `file` | Current primary sequence minus the last sequence the standby acknowledged. |
| `tabularius_standby_last_seen_timestamp_seconds` | gauge | `standby`, `file` | Time the standby last requested changes. |

### Process resources

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `process_resident_memory_bytes` | gauge | None | Process resident memory in bytes. |
| `nodejs_heap_used_bytes` | gauge | None | JavaScript heap in use, in bytes. |
| `nodejs_active_resources` | gauge | None | Active resources such as timers, sockets and other handles. |
| `process_cpu_seconds_total` | counter | None | Cumulative user and system CPU time in seconds. |
| `nodejs_eventloop_delay_p99_seconds` | gauge | None | 99th-percentile event loop delay in seconds since the previous render/scrape; rendering resets the histogram. |

The current server does not emit `tabularius_build_info` or disk capacity
metrics; `tabularius_disk_free_bytes` reports free space only. Use a host exporter
for filesystem capacity.

## Example alerting rules

Save the following as a Prometheus rule file and include its path in
`rule_files` in `prometheus.yml`. Adjust thresholds and durations for the
deployment. The disk rule requires a separately scraped Linux node exporter
job named `node`; replace `/srv/tabularius` with the actual filesystem mount
containing the hosted folder, not a subdirectory on that filesystem.

```yaml
groups:
  - name: tabularius
    rules:
      - alert: TabulariusDown
        expr: up{job="tabularius"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: 'tabularius scrape failed on {{ $labels.instance }}'

      - alert: TabulariusBackupFailed
        expr: >-
          (tabularius_backup_last_run_ok{job="tabularius"} == 0)
          or (tabularius_progressive_backup_last_run_ok{job="tabularius"} == 0)
          or (tabularius_offsite_backup_last_run_ok{job="tabularius"} == 0)
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'A backup last failed on {{ $labels.instance }}'

      - alert: TabulariusHttpErrors
        expr: >-
          sum by (job, instance) (rate(tabularius_http_requests_total{job="tabularius",status="5xx"}[5m]))
          / sum by (job, instance) (rate(tabularius_http_requests_total{job="tabularius"}[5m])) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'More than 5% of requests fail on {{ $labels.instance }}'

      - alert: TabulariusDiskLow
        expr: >-
          node_filesystem_avail_bytes{job="node",mountpoint="/srv/tabularius"}
          / node_filesystem_size_bytes{job="node",mountpoint="/srv/tabularius"} < 0.10
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: 'Less than 10% disk space available on {{ $labels.instance }}'
```

`TabulariusDown` also catches authentication, TLS and network failures: check the
Prometheus target error before treating it as a process failure. The backup
rule cannot detect a backup that never ran or a stale success; add age checks
using the corresponding `*_last_run_timestamp_seconds` gauges and
`absent(...)` checks for expected backup series, scoped to each target.
The HTTP rule needs traffic and a recorded `5xx` series; it has no result
before those exist. For script failures, alert on
`increase(tabularius_schedule_failures_total{job="tabularius"}[15m]) > 0`, or on
`tabularius_schedule_last_error{job="tabularius"} != 0` for the latest outcome.
