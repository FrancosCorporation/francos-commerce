FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV COMMERCE_DB=/data/francos-commerce.db
VOLUME /data
EXPOSE 3200
CMD ["node", "server.js"]
