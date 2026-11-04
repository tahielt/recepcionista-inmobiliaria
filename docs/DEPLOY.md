# Producción en un VPS (Dokploy + Cloudflare)

```
WhatsApp ─▶ Evolution ─▶ Chatwoot ─▶ n8n ─▶ Chatwoot ─▶ Evolution ─▶ WhatsApp     (red interna de Docker)

Internet ─▶ Cloudflare DNS ─▶ VPS :443 ─▶ Traefik de Dokploy (HTTPS, Let's Encrypt)
                                           ├─ chat.tudominio.com ─▶ chatwoot-web:3000   (app del celular)
                                           ├─ n8n.tudominio.com  ─▶ n8n:5678            (solo el editor; /webhook no)
                                           └─ evo.tudominio.com  ─▶ evolution:8080      (API y manager, con apikey)
```

**Cómo se reparte el trabajo:**
- **Dokploy** pone Traefik con HTTPS, el panel del servidor y el monitoreo.
- **El stack** lo levanta `npm run instalar`, igual que en la PC. Se le suma `docker-compose.dokploy.yml`,
  que agrega los labels de Traefik según el "método manual" de la doc de Dokploy: red `dokploy-network`,
  entrypoint `websecure` y certResolver `letsencrypt`.

Hay un solo `.env`, y actualizar es `git pull && npm run instalar`. Ese comando también aplica las
migraciones y reimporta el flujo, algo que el deploy por Git de Dokploy no hace.

> Verificado con `traefik:v3.6.25`, la versión que instala Dokploy, configurado como Dokploy (provider
> docker con `exposedByDefault: false` y red `dokploy-network`): los tres subdominios rutean bien y
> `n8n.…/webhook` responde 404 desde afuera. No lo probé sobre un Dokploy real.

## 1. VPS

| Recurso | Recomendado | Por qué |
|---|---|---|
| RAM | **8 GB** para 10 inmobiliarias (4 GB + 2 GB de swap alcanza para pocas) | stack ~1,6 GB en reposo y 2,5–3 GB con uso, Dokploy ~0,5 GB, y cada WhatsApp de Evolution suma un poco |
| Disco | 40 GB o más | imágenes ~8 GB, más bases y backups |
| Sistema | Ubuntu 24.04 LTS | Dokploy lo soporta |
| Puertos | 22, 80, 443 (y 3000 hasta configurar Dokploy) | 80 y 443 para Traefik y Let's Encrypt |

Con 4 GB, agregá swap:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 2. Dokploy

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

Necesita libres el 80, el 443 y el 3000. Entrá a `http://IP-DEL-VPS:3000` y creá el admin de Dokploy.
Como Dokploy ocupa el 3000, Chatwoot va a usar otro puerto local (`CHATWOOT_PUERTO=3100`, en el paso 4).

## 3. DNS en Cloudflare

En *DNS → Records*, agregá tres registros **A** con la IP del VPS: `chat`, `n8n` y `evo`.

Dejalos en **DNS only** (nube gris). Traefik saca los certificados de Let's Encrypt validando por HTTP
en el puerto 80. Con la nube naranja, esa validación puede fallar al renovar. Si querés el proxy de
Cloudflare o no podés abrir el 80 y el 443, usá el túnel (ver al final) en lugar de Traefik.

## 4. Instalar el stack

Node.js 20 o más nuevo, y el repo en `/opt/recepcionista`:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs git
git clone https://github.com/tahielt/recepcionista-inmobiliaria /opt/recepcionista
cd /opt/recepcionista && npm ci
cp .env.example .env && chmod 600 .env
```

En `.env`, configurá la producción. Los secretos los genera `instalar`:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.dokploy.yml
DOMINIO_CHAT=chat.tudominio.com
DOMINIO_N8N=n8n.tudominio.com
DOMINIO_EVO=evo.tudominio.com
CHATWOOT_URL_PUBLICA=https://chat.tudominio.com
N8N_URL_PUBLICA=https://n8n.tudominio.com
CHATWOOT_PUERTO=3100
```

```bash
npm run instalar
```

**Apenas termina, entrá a https://chat.tudominio.com y a https://n8n.tudominio.com y creá los dos
administradores.** Mientras no existan, cualquiera que llegue a esas URLs los puede crear.

Después pegá los dos tokens en `.env`, `CHATWOOT_API_TOKEN` y `OPENROUTER_API_KEY`, y corré de nuevo
`npm run instalar`. Si Let's Encrypt tarda, esperá un minuto y recargá. En Dokploy, en *Docker*, vas
a ver los contenedores del stack.

## 5. Backups diarios de Postgres

`scripts/backup.sh` guarda un `.dump` comprimido por base (`inmo`, `chatwoot`, `n8n` y `evolution`) en
`backups/` y borra los de más de 14 días. Lo probé con un backup y su restauración.

```bash
crontab -e
# todos los días a las 03:30
30 3 * * * /opt/recepcionista/scripts/backup.sh >> /opt/recepcionista/backups/backup.log 2>&1
```

**Copia fuera del VPS.** Un backup que vive en el mismo servidor no sirve si se pierde el servidor.
Instalá rclone (`apt install -y rclone`) y configurá un remoto con `rclone config`, por ejemplo un
bucket de Cloudflare R2. Después definí `BACKUP_RCLONE=r2:mi-bucket/recepcionista` en `.env`.

**Restaurar una base**, por ejemplo `inmo`. Antes pará los servicios que la usan: n8n para `inmo` y
`n8n`, Chatwoot para `chatwoot`, Evolution para `evolution`.

```bash
docker compose stop n8n
docker compose exec -T postgres pg_restore -U postgres -d inmo --clean --if-exists < backups/inmo-AAAA-MM-DD_HHMM.dump
docker compose start n8n
```

Los adjuntos de Chatwoot (fotos y audios) no están en Postgres sino en el volumen
`recepcionista_chatwoot_storage`. Si querés guardarlos también:
`docker run --rm -v recepcionista_chatwoot_storage:/datos -v /opt/recepcionista/backups:/b alpine tar czf /b/chatwoot-storage.tgz -C /datos .`

## 6. Actualizar

**Código: flujo, scripts y migraciones.**

```bash
cd /opt/recepcionista && git pull && npm ci && npm run instalar
```

`instalar` es idempotente: aplica las migraciones nuevas, reimporta y publica el flujo, y reinicia n8n.

**Versiones: n8n, Chatwoot, Evolution y cloudflared.** Están fijas en `.env`. Para subir de versión:

1. `scripts/backup.sh`.
2. Leé las notas de la versión nueva.
3. Cambiá la variable en `.env`, por ejemplo `CHATWOOT_VERSION=v4.20.0`.
4. `npm run instalar`. Compose recrea solo lo que cambió. Chatwoot migra su base con `chatwoot-init` y n8n
   migra la suya al arrancar.
5. Revisá `docker compose ps`, que tiene que dar todo `healthy`, y `npm run test:e2e` en tu PC con la
   misma versión.

Si algo sale mal, volvé a la versión anterior en `.env`, restaurá el backup y corré `npm run instalar`.

Dokploy se actualiza desde su propio panel.

## 7. Seguridad

- Los puertos del stack solo escuchan en `127.0.0.1`. Desde afuera se entra únicamente por Traefik.
- Los webhooks de n8n no están publicados: Chatwoot llama a n8n por la red interna.
- La API y el manager de Evolution (`evo.`) piden la `EVOLUTION_API_KEY`, que instalar genera al azar.
- `.env` con permisos `600`: tiene todos los secretos.
- WhatsApp por Evolution (Baileys) no es la API oficial de Meta. Usá cada número para atención uno a
  uno y nunca para envíos masivos, que es lo que hace que WhatsApp bloquee números.

## Alternativa sin abrir puertos: túnel de Cloudflare

Si no querés Traefik, o no podés abrir el 80 y el 443:

1. No pongas `COMPOSE_FILE` en `.env`.
2. En Cloudflare Zero Trust, en *Networks → Tunnels*, creá un túnel con estos *public hostnames*:
   - `chat.` → `http://chatwoot-web:3000`
   - `n8n.` → `http://n8n:5678`
   - `evo.` → `http://evolution:8080`
3. Pegá el token en `CLOUDFLARE_TUNNEL_TOKEN` y agregá `COMPOSE_PROFILES=tunel` en `.env`.

En este caso el HTTPS lo pone Cloudflare. Ojo: por el túnel, `/webhook` de n8n queda público. Si no
necesitás el editor desde afuera, no publiques `n8n.`. Ver [PUESTA-EN-MARCHA.md](PUESTA-EN-MARCHA.md#5-entrar-desde-el-celular-túnel-de-cloudflare).

---

Alta de cada inmobiliaria: **[ALTA-CLIENTE.md](ALTA-CLIENTE.md)** (menos de 30 minutos).
