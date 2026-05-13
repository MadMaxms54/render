FROM node:20

RUN apt-get update && apt-get install -y \
    wget \
    xvfb \
    tini \
    fonts-liberation \
    fonts-noto \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    tzdata \
    --no-install-recommends \
    && wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y ./google-chrome-stable_current_amd64.deb \
    && rm google-chrome-stable_current_amd64.deb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY ma.js ./

ENV DISPLAY=:99
ENV CHROME_PATH=/usr/bin/google-chrome-stable
ENV TZ=America/New_York
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en

EXPOSE 3000
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset & sleep 1 && node ma.js"]
