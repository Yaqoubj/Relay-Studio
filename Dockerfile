FROM node:24-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV RELAY_API_HOST=0.0.0.0
ENV RELAY_API_PORT=4317
ENV RELAY_API_DATA=/data
VOLUME ["/data"]
EXPOSE 4317

CMD ["npm", "run", "server"]
