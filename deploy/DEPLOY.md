# Deploy na VPS (Hostinger KVM 1: 1 vCPU, 4 GB, 50 GB)

Na VPS tudo roda em Docker, e cada projeto tem o seu próprio nginx:

```
                          ┌─ gendata.tech ─────────► [nginx do gendata]  ► app do gendata
Internet ─80/443─► [edge] ┤
                          └─ discord.gendata.tech ─► [discord-rea-nginx] ► [discord-rea-server] Node + SQLite
                                                       [discord-rea-certbot] renova o certificado
Internet ─3478 + 49160-49200/udp─► [discord-rea-turn]  coturn (só se o P2P falhar)
```

| Peça | Onde fica | O que faz |
|---|---|---|
| **edge** (HAProxy) | `/opt/edge` (pasta `deploy/edge` deste repositório) | Único dono das portas 80/443. Só lê o domínio pedido e repassa a conexão. **Não abre o HTTPS** e não tem configuração de site. |
| **nginx do discord** | este projeto | Certificado, HTTPS, WebSocket, rate limit, uploads |
| **Node + SQLite** | este projeto | O banco é o arquivo `rea.db` no volume `discord-rea_rea-data`. Não publica porta nenhuma: só o nginx do discord chega nele. |
| **certbot** | este projeto | Renova o certificado do discord a cada 12h (o nginx recarrega sozinho) |
| **coturn** | este projeto (opcional) | TURN para quem está atrás de CGNAT, com teto de banda |

Garantias, todas testadas numa simulação com o gendata:
- Se o discord inteiro cair, o gendata.tech segue no ar.
- O edge sobe mesmo com algum projeto fora do ar.
- O nginx do discord recebe o **IP real** do visitante (PROXY protocol), e é isso que faz o limite de tentativas de login funcionar por pessoa.
- A virada do gendata para trás do edge deixou o site fora do ar por ~2 segundos.

**Vídeo, tela e câmera não passam pela VPS**: vão P2P entre os PCs. A VPS só cuida de chat, login e sinalização.
O único caso em que a mídia passa pela VPS é o TURN (CGNAT), e aí há teto duplo: o app limita a 720p30 e 2,5 Mbps, e o coturn limita a 3,6 Mbps por sessão e 24 Mbps no total.

## 0. Antes de começar

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E ':80->|:443->'   # o nginx do gendata (dono do 80/443 hoje)
docker inspect NOME_DO_NGINX_GENDATA --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'   # pasta do compose dele
docker network ls | grep 172.30 ; docker network inspect $(docker network ls -q) --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}' | grep 172.30
free -h; df -h
```

O último `grep` precisa vir **vazio**: a rede `edge` usa a faixa `172.30.0.0/24`. Se já estiver em uso, troque a faixa em `deploy/edge/docker-compose.yml`, nos dois `set_real_ip_from` de `deploy/nginx/`, e no gendata (passo 8, se for usar).

Se o gendata.tech publicar também a `443/udp` (HTTP/3), avise antes da virada: o edge cuida só de TCP.

## 1. DNS

No hPanel, vá em **Domínios → gendata.tech → DNS** e crie um registro **A** com nome `discord` apontando para o IP da VPS.
Se o DNS estiver na Cloudflare, use a **nuvem cinza** (só DNS), porque o TURN não funciona pelo proxy da Cloudflare.

```bash
nslookup discord.gendata.tech
```

## 2. Firewall

Libere as portas no firewall da VPS (hPanel → VPS → Firewall) e/ou no `ufw`:

| Porta | Para quê |
|---|---|
| 22/tcp | SSH |
| 80/tcp, 443/tcp | edge (já liberadas, hoje para o gendata) |
| 3478/udp, 3478/tcp | TURN (só se for usar o coturn) |
| 49160-49200/udp | faixa de relay do TURN (só se for usar o coturn) |

```bash
sudo ufw allow 3478/udp && sudo ufw allow 3478/tcp && sudo ufw allow 49160:49200/udp
```

## 3. Swap (se `free -h` mostrar `Swap: 0`)

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 4. Código e segredos

```bash
sudo git clone git@github.com:SEU_USUARIO/discord-rea.git /opt/discord-rea   # repositório privado + deploy key
cd /opt/discord-rea
cp .env.example .env
sed -i "s/^REA_ADMIN_TOKEN=.*/REA_ADMIN_TOKEN=$(openssl rand -hex 32)/" .env
sed -i "s/^TURN_SECRET=.*/TURN_SECRET=$(openssl rand -hex 32)/" .env   # pule se não for usar TURN
chmod 600 .env && cat .env      # guarde o REA_ADMIN_TOKEN: é ele que gera os convites
```

## 5. Edge: criar a rede (sem ligar ainda)

O edge é um projeto à parte, que não pertence nem ao discord nem ao gendata:

```bash
sudo cp -r /opt/discord-rea/deploy/edge /opt/edge
cd /opt/edge && docker compose up --no-start      # cria a rede "edge"; o container fica parado
```

## 6. Subir o Discord REA

Sem certificado ainda: o nginx do discord sobe só com a porta 80. Ninguém acessa até o passo 7, e o gendata não é afetado.

```bash
cd /opt/discord-rea
docker compose -f docker-compose.prod.yml --profile turn up -d --build   # sem TURN: tire o --profile turn
docker logs discord-rea-nginx | grep discord-rea    # => "sem certificado ainda, so HTTP"
docker logs discord-rea-server                      # => "... | TURN: discord.gendata.tech"
```

## 7. Virada: o gendata passa para trás do edge

A única mudança no gendata é no `docker-compose.yml` dele, no serviço do nginx:

```yaml
services:
  nginx:                          # o serviço nginx que já existe
    # ports:                      # ← REMOVA (ou comente) a publicação do 80/443
    #   - "80:80"
    #   - "443:443"
    networks:
      default:                    # mantenha as redes que ele já usa
      edge:
        aliases: [gendata-nginx]  # é por esse nome que o edge chega nele

networks:
  edge:
    external: true
```

Faça backup do arquivo antes (`cp docker-compose.yml docker-compose.yml.antes-edge`). Depois, num comando só, para o site ficar fora o mínimo possível (~2 s):

```bash
(cd PASTA_DO_GENDATA && docker compose up -d nginx) && (cd /opt/edge && docker compose up -d)
curl -I https://gendata.tech       # o site do gendata segue igual, com o certificado dele
```

**Voltar atrás**, se algo der errado:

```bash
cd /opt/edge && docker compose stop
cd PASTA_DO_GENDATA && cp docker-compose.yml.antes-edge docker-compose.yml && docker compose up -d nginx
```

## 8. (Opcional) IP real também no gendata

Depois da virada, o nginx do gendata passa a ver o IP do edge (`172.30.0.x`) em vez do visitante. O site funciona normal, mas os logs e um eventual rate limit dele perdem o IP real. Para corrigir, mude os **dois lados juntos**:

- `/opt/edge/haproxy.cfg`, no `backend gendata_https`: `server nginx gendata-nginx:443 send-proxy-v2 resolvers docker init-addr none`
- No nginx do gendata, em cada `server` da porta 443:
  ```nginx
  listen 443 ssl proxy_protocol;
  set_real_ip_from 172.30.0.0/24;
  real_ip_header proxy_protocol;
  ```

```bash
docker exec NGINX_GENDATA nginx -t && docker restart NGINX_GENDATA edge-haproxy
```

## 9. Certificado do discord

A emissão usa o certbot do próprio projeto, validado pela porta 80 (edge → nginx do discord):

```bash
cd /opt/discord-rea
docker compose -f docker-compose.prod.yml run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot -d discord.gendata.tech --email SEU_EMAIL --agree-tos --no-eff-email
docker compose -f docker-compose.prod.yml restart nginx
docker logs discord-rea-nginx | grep discord-rea    # => "HTTPS ligado"
```

A renovação é automática: o container `discord-rea-certbot` tenta a cada 12h, e o nginx recarrega a cada 12h.

## 10. Teste de ponta a ponta

```bash
TOKEN=$(grep REA_ADMIN_TOKEN .env | cut -d= -f2)
curl -X POST https://discord.gendata.tech/api/admin/invites -H "Authorization: Bearer $TOKEN"
curl https://discord.gendata.tech/api/admin/stats -H "Authorization: Bearer $TOKEN"
curl -I https://gendata.tech
```

O app (`npm start`, ou o instalado) já conecta em `wss://discord.gendata.tech`. Registre-se com o convite e entre.

## 11. Backup diário

Faz uma cópia consistente do SQLite (mesmo com o servidor rodando) e dos anexos, e guarda os últimos 7 dias:

```bash
sudo mkdir -p /opt/backups && sudo crontab -e
```
```cron
0 4 * * * docker exec discord-rea-server node server/backup.js && docker run --rm -v discord-rea_rea-data:/data:ro -v /opt/backups:/b alpine tar czf /b/rea-$(date +\%F).tgz -C /data backups files && find /opt/backups -name 'rea-*.tgz' -mtime +7 -delete
```

O ideal é copiar o `/opt/backups` também para fora da VPS (rclone para o Google Drive, por exemplo).

**Restaurar:** pare o servidor, extraia o `.tgz`, coloque `backups/rea.db` no lugar de `rea.db` (apague `rea.db-wal` e `rea.db-shm`) e `files/` no volume.

## Dia a dia

| Tarefa | Comando (em `/opt/discord-rea`) |
|---|---|
| Atualizar | `git pull && docker compose -f docker-compose.prod.yml --profile turn up -d --build` |
| Logs | `docker logs -f discord-rea-server` / `discord-rea-nginx` / `discord-rea-turn` / `edge-haproxy` |
| Consumo | `docker stats edge-haproxy discord-rea-nginx discord-rea-server discord-rea-turn` |
| Números do sistema | `curl https://discord.gendata.tech/api/admin/stats -H "Authorization: Bearer $TOKEN"` |
| Gerar convite | `curl -X POST https://discord.gendata.tech/api/admin/invites -H "Authorization: Bearer $TOKEN" -d '{"note":"pra quem"}'` |
| Mudou `deploy/nginx/` | `docker compose -f docker-compose.prod.yml restart nginx` |
| Projeto novo na VPS | um `use_backend` + um `backend` em `/opt/edge/haproxy.cfg`, depois `docker restart edge-haproxy` |

## Limites e quando crescer

- **Chat e sinalização:** um processo Node aguenta centenas de pessoas conectadas. O SQLite em WAL grava só o que muda.
- **Anexos:** cota total em `FILES_QUOTA_MB` (padrão 10 GB). Quando enche, novos uploads recebem "o espaço para anexos do servidor acabou". Anexos de mensagens apagadas são removidos do disco.
- **Calls:** P2P funciona bem até umas 5 ou 6 pessoas por call. Quem transmite só envia a tela para quem clicou em "Assistir", mas cada espectador é uma cópia a mais no upload de quem transmite. Calls grandes (10, 20 ou mais) exigem um SFU (LiveKit/mediasoup) numa máquina maior, porque não cabem nesta VPS.
- **TURN:** ~1,1 GB/h por sentido para cada transmissão relayed (com o teto de 2,5 Mbps). Fique de olho na franquia mensal de tráfego no hPanel.
- **Memória medida:** edge ~14 MB, nginx do discord ~13 MB, Node ~16 MB (parado), certbot ~2 MB.
