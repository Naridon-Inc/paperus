# Faster Dockerfile: Just serve the local dist-web
FROM nginx:stable-alpine

COPY dist-web /usr/share/nginx/html

# Default nginx config with caching and proxy to backend
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    # Gzip Compression \
    gzip on; \
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript; \
    \
    location / { \
        try_files $uri $uri/ /index.html; \
        # Dont cache index.html so we always get latest bundle refs \
        add_header Cache-Control "no-store, no-cache, must-revalidate"; \
    } \
    \
    # Cache static assets (Vite hashes filenames so this is safe) \
    location /assets/ { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
    \
    location /auth { \
        proxy_pass http://localhost:9008; \
        proxy_set_header Host $host; \
        proxy_set_header X-Forwarded-Proto $scheme; \
    } \
    location /teams { \
        proxy_pass http://localhost:9008; \
        proxy_set_header Host $host; \
        proxy_set_header X-Forwarded-Proto $scheme; \
    } \
    location /fs { \
        proxy_pass http://localhost:9008; \
        proxy_set_header Host $host; \
        proxy_set_header X-Forwarded-Proto $scheme; \
    } \
    location /documents { \
        proxy_pass http://localhost:9008; \
        proxy_set_header Host $host; \
        proxy_set_header X-Forwarded-Proto $scheme; \
    } \
    location /yjs { \
        proxy_pass http://localhost:9008; \
        proxy_http_version 1.1; \
        proxy_set_header Upgrade $http_upgrade; \
        proxy_set_header Connection "Upgrade"; \
        proxy_set_header Host $host; \
        proxy_set_header X-Forwarded-Proto $scheme; \
    } \
    location /notifications { \
        proxy_pass http://localhost:9008; \
        proxy_http_version 1.1; \
        proxy_set_header Upgrade $http_upgrade; \
        proxy_set_header Connection "Upgrade"; \
        proxy_set_header Host $host; \
        proxy_set_header X-Forwarded-Proto $scheme; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
