# Production Deployment (Oracle VPS + Domain)

## Domains
- Frontend: `taskweb.hyi96.dev`
- API: `taskweb-api.hyi96.dev`

## 1) Server prerequisites
- Docker + Docker Compose plugin installed.
- Nginx + Certbot installed.
- OCI ingress rules open for TCP `22`, `80`, `443`.
- UFW allows `22`, `80`, `443`.

## 2) Project layout on VPS
```bash
mkdir -p ~/apps/taskweb/{app,infra,env,logs}
cd ~/apps/taskweb/app
git clone <YOUR_REPO_URL> .
cp .env.prod.example ../env/.env.prod
```

Edit `../env/.env.prod` with real secrets/domains.

## 3) Backend deploy
```bash
cd ~/apps/taskweb/app
docker compose -f docker-compose.prod.yml --env-file ../env/.env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file ../env/.env.prod exec web python manage.py migrate
docker compose -f docker-compose.prod.yml --env-file ../env/.env.prod exec web python manage.py createsuperuser
```

## 4) Nginx config (API + frontend)
```bash
sudo cp infra/nginx/taskweb-api.conf /etc/nginx/sites-available/taskweb-api.conf
sudo cp infra/nginx/taskweb-frontend.conf /etc/nginx/sites-available/taskweb-frontend.conf
sudo ln -s /etc/nginx/sites-available/taskweb-api.conf /etc/nginx/sites-enabled/taskweb-api.conf
sudo ln -s /etc/nginx/sites-available/taskweb-frontend.conf /etc/nginx/sites-enabled/taskweb-frontend.conf
sudo nginx -t
sudo systemctl reload nginx
```

Note: update `root` in `infra/nginx/taskweb-frontend.conf` if your VPS username/path differs.

## 5) Frontend build
```bash
npm --prefix frontend ci
VITE_STORAGE_MODE=api VITE_API_BASE_URL=https://taskweb-api.hyi96.dev npm --prefix frontend run build
```

## 6) TLS certificates
```bash
sudo certbot --nginx -d taskweb-api.hyi96.dev
sudo certbot --nginx -d taskweb.hyi96.dev
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

## 7) One-command redeploy
```bash
./scripts/deploy_prod.sh
```

If env file is elsewhere:
```bash
ENV_FILE=/path/to/.env.prod ./scripts/deploy_prod.sh
```

## 8) Smoke checks
- `https://taskweb-api.hyi96.dev/healthz/`
- `https://taskweb-api.hyi96.dev/api/auth/session/`
- Open `https://taskweb.hyi96.dev` and test sign-up/sign-in + task actions.
