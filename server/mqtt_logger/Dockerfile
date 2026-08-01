FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY protocol.js index.js ./

CMD ["node", "index.js"]
