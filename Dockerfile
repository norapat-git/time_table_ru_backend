FROM node:18-bullseye

ENV NODE_ENV=production
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --production --silent \
    && npm install -g pm2 nodemon

# ===== install dependency oracle & download Instant Client =====
RUN apt-get update && apt-get install -y --no-install-recommends \
    libaio1 \
    tzdata \
    wget \
    unzip \
    && mkdir -p /usr/lib/instantclient \
    && wget -q https://download.oracle.com/otn_software/linux/instantclient/1923000/instantclient-basiclite-linux.x64-19.23.0.0.0dbru.zip -O /tmp/instantclient.zip \
    && unzip -q /tmp/instantclient.zip -d /tmp/ic/ \
    && cp -r /tmp/ic/instantclient_*/* /usr/lib/instantclient/ \
    && rm -rf /tmp/instantclient.zip /tmp/ic \
    && ln -sf /usr/lib/instantclient/libclntsh.so.* /usr/lib/instantclient/libclntsh.so \
    && rm -rf /var/lib/apt/lists/*

ENV LD_LIBRARY_PATH=/usr/lib/instantclient:$LD_LIBRARY_PATH
ENV ORACLE_HOME=/usr/lib/instantclient
ENV TNS_ADMIN=/usr/lib/instantclient/network/admin

COPY . .

RUN chown -R node:node /usr/src/app

USER node

EXPOSE 4000

CMD ["pm2-runtime", "start", "system_prod.config.js", "--env", "production"]