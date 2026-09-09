FROM nginx:1.29-alpine
COPY gateway/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY gateway/nginx/proxy-params.conf /etc/nginx/snippets/proxy-params.conf
COPY gateway/nginx/nginx.conf /etc/nginx/conf.d/default.conf
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/gateway-health || exit 1
