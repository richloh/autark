# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Set the site URL for build
ARG SITE_URL=https://autark-demo.tmt-labs.de
ENV SITE_URL=$SITE_URL

# Build the application
RUN npm run build

# Production stage - serve with nginx
FROM nginx:alpine

# Copy built static files to nginx html directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 4321 to match docker-compose configuration
EXPOSE 4321

# Copy custom nginx config to serve on port 4321
RUN echo 'server { \
    listen 4321; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    # Disable adding port to redirects \
    port_in_redirect off; \
    \
    # Use relative redirects \
    absolute_redirect off; \
    \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

CMD ["nginx", "-g", "daemon off;"]
