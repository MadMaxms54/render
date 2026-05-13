FROM node:20

RUN apt-get update && apt-get install -y \
    chromium \
    xvfb \
    tini \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY ma.js ./

ENV DISPLAY=:99
ENV CHROME_PATH=/usr/bin/chromium

EXPOSE 3000
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "Xvfb :99 -screen 0 1280x720x24 & sleep 1 && node ma.js"]
