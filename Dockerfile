FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV COMMERCE_DB=/data/loja.db
VOLUME /data
EXPOSE 3200
CMD ["node", "server.js"]
