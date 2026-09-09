FROM node:24-alpine AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY services/records-service/package.json services/records-service/package.json
RUN npm ci --omit=dev --workspace @rhu-labchain/records-service --include-workspace-root=false

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=dependencies /workspace/node_modules ./node_modules
COPY services/records-service ./services/records-service
RUN chmod +x /workspace/services/records-service/docker-entrypoint.sh
WORKDIR /workspace/services/records-service
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
