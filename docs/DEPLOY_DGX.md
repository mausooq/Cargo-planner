# Deploying Compass on an NVIDIA DGX

Compass is a normal web app: it does **not** need the DGX's GPUs. It runs as one Docker container
next to whatever else the DGX is doing, using a little CPU and memory and a small database file.

DGX OS is Ubuntu with Docker already installed, so the steps below are the same on DGX A100/H100
(x86_64), DGX Spark, and GH200 (ARM64). Build the image **on the DGX itself** so it matches its CPU.

---

## 1. Before you start

You need:

- SSH access to the DGX, and a user in the `docker` group (check with `docker ps`; if it says
  "permission denied", ask your admin to run `sudo usermod -aG docker <you>`, then log in again).
- Network access from the DGX to the npm registry (`registry.npmjs.org`) and Docker Hub, for the
  first build. If the DGX is offline, see [Offline DGX](#offline-dgx) below.
- A free port. These steps use **3000**.

Check Docker and Compose:

```bash
docker --version
docker compose version
```

## 2. Get the code onto the DGX

**From GitHub** (once the branch is pushed):

```bash
git clone <your-repo-url> compass-planner
cd compass-planner
git checkout ux-improvements
```

**Or copy it from your PC** (from the project folder on Windows, in Git Bash or PowerShell):

```bash
scp -r . <user>@<dgx-host>:~/compass-planner
```

## 3. Set the secrets

```bash
cd ~/compass-planner
cp .env.production.example .env.production
openssl rand -base64 32        # copy the output
nano .env.production           # paste it as AUTH_SECRET="..."
```

Keep `.env.production` private; git already ignores it.

## 4. Build and start

```bash
docker compose up -d --build
```

The first build takes a few minutes (it installs packages and builds the app). Watch it start:

```bash
docker compose logs -f compass
```

When you see `Ready`, press Ctrl+C (the app keeps running).

## 5. Load the equipment library and accounts (first time only)

```bash
docker compose run --rm compass pnpm db:seed
```

This imports the containers, ULDs, trucks, and pallets from the workbooks and creates the three
starter accounts (`admin@`, `planner@`, `viewer@compass.local`).

## 6. Set real passwords (important)

The starter accounts begin with the shared demo password. Change them before anyone else signs in:

```bash
docker compose exec compass pnpm user:set admin@compass.local 'a-long-new-password'
docker compose exec compass pnpm user:set planner@compass.local 'another-long-password'
docker compose exec compass pnpm user:set viewer@compass.local 'and-another-one'
```

Add a person (role `ADMIN`, `PLANNER`, or `VIEWER`):

```bash
docker compose exec compass pnpm user:set priya@yourcompany.com 'their-password' --name "Priya S" --role PLANNER
```

Re-running `pnpm db:seed` later (e.g. after updating the equipment workbook) does **not** reset
passwords.

## 7. Open it

From any computer on the same network:

```
http://<dgx-host-or-ip>:3000
```

Find the DGX's address with `hostname -I` on the DGX. If the page doesn't load, open the port in
the firewall (if one is active):

```bash
sudo ufw status            # "inactive" means nothing to do
sudo ufw allow 3000/tcp
```

---

## Everyday operations

| Task | Command |
| --- | --- |
| See if it's running | `docker compose ps` |
| Logs | `docker compose logs -f compass` |
| Restart | `docker compose restart compass` |
| Stop | `docker compose down` (data is kept) |
| Update to new code | `git pull && docker compose up -d --build` |

Database migrations run automatically every time the container starts.

### Back up the database

The data is one file in the `compass-data` volume. Copy it out (safe while running for a quick
backup; stop first for a guaranteed-consistent copy):

```bash
docker compose cp compass:/data/compass.db ./compass-backup-$(date +%F).db
```

Restore:

```bash
docker compose stop compass
docker compose cp ./compass-backup-2026-11-20.db compass:/data/compass.db
docker compose start compass
```

Schedule the backup daily with `crontab -e`, for example:

```
0 2 * * * cd ~/compass-planner && docker compose cp compass:/data/compass.db ~/backups/compass-$(date +\%F).db
```

---

## Use a domain name

A name such as `compass.yourcompany.com` needs two things: the name must point at the DGX (your IT
team does this), and the DGX must answer on the normal web ports (the built-in proxy does this).

### 1. Ask IT for the name

Send them the DGX address (`hostname -I`) and ask for one of:

- **Inside the company only (usual choice):** "Please add an internal DNS record
  `compass.yourcompany.com` pointing to `<DGX address>`." Everyone on the office network or VPN can
  then use it. Nothing is exposed to the internet.
- **From the public internet:** this also needs a public IP or port forwarding for ports 80 and 443
  to the DGX, and a security review. Do not do this without IT: it puts the DGX on the internet.

### 2. Turn on the proxy

Add the address to `.env.production` (pick one line):

| You have | Line to add |
| --- | --- |
| An internal name, plain HTTP | `COMPASS_SITE_ADDRESS="http://compass.yourcompany.com"` |
| A public name, automatic HTTPS | `COMPASS_SITE_ADDRESS="compass.yourcompany.com"` |
| No name yet, just drop the `:3000` | `COMPASS_SITE_ADDRESS=":80"` |

Start it:

```bash
docker compose --profile domain up -d
```

People now open `http://compass.yourcompany.com` (no port). Keep using `--profile domain` on later
`up` commands, e.g. `git pull && docker compose --profile domain up -d --build`.

Notes:

- **HTTPS inside the company.** Automatic certificates only work for names reachable from the
  internet. For HTTPS on an internal-only name, ask IT for a certificate for that name (or to put
  Compass behind the company's existing HTTPS proxy, pointing at `http://<DGX address>:3000`).
- **"port is already allocated" for 80 or 443** means another web server already runs on the DGX.
  Ask IT to add Compass to that server instead (proxy the name to `127.0.0.1:3000`).
- Once everyone uses one HTTPS address, set `AUTH_URL="https://compass.yourcompany.com"` in
  `.env.production` and run the `up` command again.
- To close direct access on port 3000 afterwards, change `"3000:3000"` to `"127.0.0.1:3000:3000"`
  in `docker-compose.yml`.

## Reading packing lists from a photo or PDF (optional)

On the Cargo step, planners can drop a photo, screenshot, or PDF of a packing list and Compass fills
in the lines. The file is sent to Claude (Anthropic) to be read, so this needs:

1. An API key in `.env.production`: `ANTHROPIC_API_KEY="sk-ant-..."`. Keep it out of git and chat.
2. Internet access from the DGX to `api.anthropic.com` (port 443).

Then restart: `docker compose up -d`. Without a key the feature says it is not set up; Excel and CSV
import work as before.

Reading takes 10 to 30 seconds. If nginx sits in front of Compass, give it room for that and for
uploads in the `server { ... }` block, then `sudo nginx -t && sudo systemctl reload nginx`:

```nginx
client_max_body_size 20m;
proxy_read_timeout 180s;
```

Each read costs a few cents on the key's account. Company documents leave the DGX for this step, so
check that is acceptable before turning it on.

## Offline DGX

If the DGX can't reach the internet, build the image on a machine that can **with the same CPU
type** (x86_64 or ARM64), then move it:

```bash
# on the connected machine
docker compose build
docker save compass-planner:latest | gzip > compass-image.tar.gz
# copy compass-image.tar.gz, docker-compose.yml and .env.production to the DGX, then on the DGX:
docker load < compass-image.tar.gz
docker compose up -d
```

The app itself needs no internet at run time (fonts are system fonts; nothing is fetched).

## Notes and limits

- **No GPU use.** Don't add GPU options to the container; the planner runs in each user's browser
  and on the CPU.
- **SQLite** suits a team sharing one server. For many simultaneous editors or a high-availability
  setup, move to PostgreSQL (the schema was written with that in mind).
- **3D needs WebGL in the user's browser.** If a browser has it switched off, step 4 shows a 2D
  drawing instead.
