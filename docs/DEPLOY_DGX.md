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

## Optional: a proper address with HTTPS

For a name like `https://compass.yourcompany.com`, put a reverse proxy in front (your IT team may
already run one). With Caddy on the DGX, for example:

```
compass.yourcompany.com {
  reverse_proxy 127.0.0.1:3000
}
```

Then set `AUTH_URL="https://compass.yourcompany.com"` in `.env.production` and run
`docker compose up -d` again.

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
