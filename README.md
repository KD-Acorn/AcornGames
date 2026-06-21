# AcornGames 🎮

A self-hosted **game-server management hub** — a single web portal to run, monitor, and control dedicated game servers, with proper user accounts and per-server permissions. Built so friends, communities, and streamers can request and manage access without anyone touching the command line.

🌐 **Live:** [acorngames.net](https://acorngames.net)
<!-- TODO: add a dashboard screenshot here — drag an image into the repo and link it:  ![Dashboard](docs/dashboard.png) -->

---

## What it does

- **Game launcher–style dashboard** — every server shown as a card with status and controls.
- **Remote control** — start, stop, and restart servers from the browser; no SSH required.
- **Role-based access control** — permissions are per server, so a user can be an admin on one server and a viewer on another:
  - `admin` — full control
  - `mod` — manage user access and requests
  - `viewer` — dashboard only; can request access to a server
- **Self-registration & access requests** — new users can sign up and request access; mods/admins approve. Built with streamer communities in mind.
- **Audit logging** — access changes and server actions are recorded.

---

## Tech stack

| Layer | Tools |
|-------|-------|
| Frontend | React, Vite |
| Backend | Node.js, Express, JWT authentication |
| Database | PostgreSQL |
| Process management | PM2 (server start/stop/restart) |
| Networking | Cloudflare Tunnels (secure HTTPS), Let's Encrypt |
| Host | Linux server in a personal home lab |

---

## A few problems I solved building this

Real infrastructure rarely fails with a clean error message. Some highlights:

- **Connections dropping after a fixed interval** — traced to an undocumented UDP port-forwarding requirement for the game's reliable-messaging system. Not in any obvious docs; found it by reading logs and isolating one variable at a time.
- **Double-NAT between two routers** — was duplicating connection packets and confusing the server handshake. Diagnosed and reconfigured the network path.
- **SSL/TLS setup** — validated certificate/key pairs with OpenSSL, configured Let's Encrypt, and tracked down a stale tunnel daemon that was silently intercepting traffic.

---

## Roadmap

**Game servers to add**
- [ ] Minecraft (Java)
- [ ] Minecraft (Bedrock)
- [ ] Valheim
- [ ] 7 Days to Die
- [ ] Project Zomboid

**Platform features**
- [ ] Game-card icons matching each game's launcher style
- [ ] Expanded streamer-friendly self-registration flow
- [ ] Migration tooling to move all servers to new hardware
- [ ] Per-server resource/health monitoring

---

## About

Built and maintained by [Kennedy Durham](https://github.com/KD-Acorn). Part of an ongoing home-lab and self-hosting project — see the [home-lab repo](https://github.com/KD-Acorn/home-lab) for the wider infrastructure.
