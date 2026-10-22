# What the service files contain, and why

`tabularius service install` writes one file for the system's own service manager; `tabularius service print <folder>` shows it without installing. This page says what each setting in those files is for, so you can judge a change before making it. Tests check every file against a strict reader for its format (`packages/cli/test/service-validators.ts`), compare it with a saved copy (`packages/cli/test/golden/service/`), and check that the arguments, the working folder and the writable folders read back as given, even for a folder called `My Data/$HOME/100%` or `Bob's`.

What is **not** checked: that macOS or Windows accepts the file when it loads it. The files have static and simulated tests; the launchd and Task Scheduler files have been read against Apple's and Microsoft's published formats, not loaded on those systems. Run `tabularius service install` once on each system you rely on and look at the result.

## systemd (Linux)

| Setting | Why |
| --- | --- |
| `ExecStart` | Node, the program, and `serve` with your options, each argument quoted. `%` and `$` are doubled, because systemd would otherwise replace `%h` or `$HOME` inside a folder name. |
| `WorkingDirectory` | The folder it hosts. |
| `Restart=on-failure`, `RestartSec=5`, `RestartSteps=5`, `RestartMaxDelaySec=60` | Starts again after a crash, waiting longer each time up to a minute. The two `Restart…` steps need systemd 254 or later; older versions ignore them and wait five seconds every time. |
| `TimeoutStopSec=60` | Saving and backing up on stop: twice the 30 seconds a restart or upgrade waits for the server to stop (`TABULARIUS_STOP_GRACE_MS`), so systemd never ends it first. |
| `UMask=0077` | Files the server makes (hosted files, backups, logs) can be read only by its account. Remove the line if another account must read them. |
| `LimitNOFILE=65536` | The default allows 1024 open files and connections; see [the runbook](runbook.md). |
| `NoNewPrivileges`, `PrivateTmp` | A process it starts cannot gain privileges; it has its own temporary folder. |
| `ProtectSystem=full`, `ReadWritePaths=-…` | `/usr`, `/boot` and `/etc` are read-only to it. The hosted folder, `~/.openhbam` and the folder that holds the program stay writable even if they sit under those. A `-` means "if it exists". `ProtectHome` is **not** set: options such as `--backup-dir` or `--tls-cert` can name files anywhere in a home folder, and the unit cannot know them all. |
| `ProtectKernelTunables`, `ProtectControlGroups`, `RestrictSUIDSGID`, `RestrictRealtime`, `LockPersonality` | It has no use for these; refusing them removes things an attacker who got into the process could use. |
| `User=`, `AmbientCapabilities=CAP_NET_BIND_SERVICE` (system unit) | Runs as you, not root, and may still listen on ports 80 and 443. |
| `WantedBy=` | `multi-user.target` for the boot service, `default.target` for the user service. |

Left out on purpose:

- `MemoryDenyWriteExecute`: Node's JavaScript engine writes machine code and runs it; the setting would stop the server starting.
- `MemoryMax`, `TasksMax`: no figure is safe for every folder (a large file needs memory in proportion to its size). Add one yourself with `systemctl edit openhbam` if the machine is shared.
- `RestrictAddressFamilies`, `SystemCallFilter`: Node lists the machine's network addresses (netlink) and a filter that is too narrow fails in ways that are hard to trace; this has not been tried on every system.

## launchd (macOS)

| Key | Why |
| --- | --- |
| `ProgramArguments`, `WorkingDirectory` | As above. |
| `RunAtLoad`, `KeepAlive` | Starts when loaded and again after any exit. |
| `ThrottleInterval` 10 | Waits ten seconds between starts, so a server that fails at once does not spin (this is launchd's own default, written down). |
| `ExitTimeOut` 40 | launchd ends the server this long after asking it to stop: the 30 seconds a restart or upgrade waits for the server to stop, plus ten. |
| `Umask` 63 | Decimal for octal 077: files it makes are for its own account. |
| `SoftResourceLimits` `NumberOfFiles` 4096 | A launchd job starts with 256 open files. Not run on a Mac here. |
| `UserName` (system only) | A LaunchDaemon runs as you, not root. |
| `StandardOutPath`, `StandardErrorPath` | The console log in `~/.openhbam/logs/server.log`. |

## Windows Task Scheduler

| Setting | Why |
| --- | --- |
| `LogonTrigger` or `BootTrigger` | At sign-in, or at boot as the system account (`--system`, from an administrator prompt). |
| `LogonType` `InteractiveToken`, `RunLevel` `LeastPrivilege` | Runs as you with no stored password and no elevation. |
| `RestartOnFailure` 1 minute, 255 times | Starts again a minute after it stops unexpectedly. Microsoft's schema allows 1 to 255 for the count (an earlier version of this file said 999, which the schema does not allow). |
| `ExecutionTimeLimit` `PT0S`, `MultipleInstancesPolicy` `IgnoreNew` | A server runs for good, and never twice. |

The CLI requests graceful shutdown through a PID-specific file in the hosted folder and waits before task restart/removal. A timeout refuses forced termination. Direct Task Scheduler End, logoff and OS shutdown are still unverified; use the [Windows readiness checklist](audits/audit-windows.md). An older server without this listener must be stopped cleanly before upgrading. <!-- known-difference: Windows hosting ;; Direct Task Scheduler End, logoff and OS shutdown are unverified ;; The server may stop without its graceful cleanup ;; Try each on a Windows machine with the scheduled task installed -->

## Secrets

Use `--mcp-token-file F` or `--replication-token-file F` after `--` to read a token from a private regular file. Install checks that the file exists, contains one nonempty line, and on Unix cannot be read by group or others (`chmod 600 F`). Relative paths become absolute paths at install time because the service starts in another working directory. The service file names the path; it does not copy the token. A symlink to a regular file is followed and its target is checked. The service account must be able to read the file when it starts. Key files (`--ai-key-file`, `--tls-key`) are also named by path.

Inline `--mcp-token` and `--replication-token` remain supported. Their values appear in the process list and are written into the service file. POSIX modes restrict that file to its owner; on Windows, modes do not enforce or verify that privacy, so restrict the file and task ACLs, including inherited permissions, to the service identity and trusted administrators. Install prints the "written into the service file" note only for inline token options. The environment alternatives are `TABULARIUS_MCP_TOKEN_FILE` and `TABULARIUS_REPLICATION_TOKEN_FILE` for `serve`; `standby` reads the replication file with `--token-file` or `TABULARIUS_REPLICATION_TOKEN_FILE`.

## What install refuses

A service that would listen beyond this computer over plain HTTP: an address other than this computer's with none of `--https`, `--tls-cert` or `--allow-plain-http` after `--`. `service print` and `upgrade` apply the same rule, so an installed service from before this rule is not restarted onto a version that would refuse to start it. With no `--host`, a service listens on this computer only (on every address when `--https <domain>` asks for a Let's Encrypt certificate). On Linux, a folder or program path that ends in a backslash or starts or ends with a space (systemd would join the next setting onto it or drop the space). Any folder, program path, account name, address or option that contains a line break or another control character (in a unit file it would add a directive; in an XML file it makes the file unreadable), a port outside 1–65535, an address with a space, and on Linux and macOS a folder or program that is not a full path.
