# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage - static files served by nginx (SPA fallback to index.html)
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 4321
RUN printf '%s\n' \
  'server {' \
  '  listen 4321;' \
  '  server_name _;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  port_in_redirect off;' \
  '  absolute_redirect off;' \
  '  gzip on;' \
  '  gzip_types text/css application/javascript application/json image/svg+xml;' \
  '  location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }' \
  '  location / { try_files $uri $uri/ /index.html; add_header Cache-Control "no-cache"; }' \
  '}' > /etc/nginx/conf.d/default.conf
CMD ["nginx", "-g", "daemon off;"]
