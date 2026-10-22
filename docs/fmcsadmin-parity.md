# fmcsadmin and the Admin API: what works here

Server administrators who know `fmcsadmin` (the command-line tool for FileMaker Server; the open-source build is at <https://github.com/emic/fmcsadmin>) can point it at a Tabularius server: the server answers FileMaker's Admin API (v2) at `/fmi/admin/api/v2`. Sign in with the admin password (any user name) as HTTP Basic. The Admin API needs an admin password to be set; the console cookie, the local admin channel and loopback access don't sign in to it. The tool's own commands are listed in its [user manual](https://github.com/emic/fmcsadmin/wiki/User-Manual); this table says what each one does against Tabularius.

**Checked** means the real fmcsadmin was run against a server (see the log at the end); **by the route** means the Admin API route the command uses exists here, but the tool itself was not run for that command; **no** means Tabularius does not do it, and says what to use instead.

| Command | Here | Notes |
| --- | --- | --- |
| `list files` | Checked | |
| `list clients` | Checked | |
| `list schedules` | Checked | Script schedules and backup schedules. |
| `list plugins` | Checked | |
| `open`, `close` | Checked | Closing a file ends its sessions and can send them a message. |
| `pause`, `resume` | Checked | |
| `disconnect` | Checked | Optionally with a message. |
| `send` | Checked | |
| `status` | By the route | Built from the file and client lists. |
| `run schedule` | Checked | |
| `enable schedule`, `disable schedule` | Checked | |
| `delete schedule` | Checked | |
| `get serverconfig`, `get serverprefs`, `get cwpconfig` | Checked | Answers values that describe Tabularius (no cache size or connection limits to speak of). |
| `set serverprefs BlockNewUsersEnabled=…` | Checked | Refuses every new sign-in; open sessions carry on. |
| `set` of any other setting | No | Answers 960 (parameter is invalid) for a name it does not know; a known setting with a value it does not take answers code 21 (not supported). |
| `certificate import`, `delete` | Checked | Installs a certificate from your own authority; see ADMIN.md. |
| `certificate create` | By the route | The CSR route exists; the emic build refused the command before sending it (see the log). |
| `stop`, `start` | By the route | Closes and reopens every hosted file; the server process keeps running. Stop and start the process itself with your service manager. |
| `restart` | No | Restart the process with your service manager. |
| `remove` | No | Answers code 21. Take the file out of the hosted folder. |
| `cancel` (a running backup) | No | The tool's `cancel` was never run against this server, so what it sends is unknown. Tabularius has its own route, `POST /tabularius/admin/v1/backup/stop`, and a **Stop backup** button in the admin console's **Backups**: the backup ends after the file it is copying, its half-made set is removed and no old set is pruned. |
| `help` | Not the server's | Handled by the tool. |
| `--fqdn`, `-i` (remote server, PKI identity file) | Partly | `--fqdn` works over HTTPS. An identity file is not used: sign in with the admin password. |

Backups, restores, the Event log, usage and everything else the admin console does are in the console and in the [REST reference](reference/rest.md); they have no fmcsadmin command in FileMaker Server either.

**Log.** The "Checked" rows come from running the real fmcsadmin (the emic build) against a local server, which found and fixed one thing (`set serverconfig` answered 10001 until the general settings stopped including `startupRestorationEnabled`). `certificate create` is refused by the tool itself in that build whatever the option order, so only `import` and `delete` were exercised end to end. `restart`, `remove` and `cancel` were not run: the table says what the server does, not what the tool sends.
