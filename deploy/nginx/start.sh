#!/bin/sh
# Inicializacao do nginx do Discord REA.
# Sem certificado ainda: sobe so a porta 80 (para o certbot validar). Com certificado: liga o HTTPS.
# Recarrega a cada 12h para pegar o certificado renovado pelo container certbot.
set -e
CERT=/etc/letsencrypt/live/discord.gendata.tech/fullchain.pem

cp /etc/nginx/rea/discord.conf /etc/nginx/conf.d/default.conf
if [ -f "$CERT" ]; then
  cp /etc/nginx/rea/discord-https.conf /etc/nginx/conf.d/discord-https.conf
  echo "discord-rea: HTTPS ligado"
else
  rm -f /etc/nginx/conf.d/discord-https.conf
  echo "discord-rea: sem certificado ainda, so HTTP. Emita o certificado e rode: docker compose -f docker-compose.prod.yml restart nginx"
fi

( while :; do sleep 12h; nginx -s reload; done ) &
exec /docker-entrypoint.sh nginx -g 'daemon off;'
