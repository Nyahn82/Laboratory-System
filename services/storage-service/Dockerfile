FROM node:24-alpine AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY packages/service-kit/package.json packages/service-kit/package.json
COPY services/storage-service/package.json services/storage-service/package.json
RUN npm ci --workspace @rhu-labchain/storage-service --include-workspace-root=false

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=dependencies /workspace/node_modules ./node_modules
COPY packages/service-kit ./packages/service-kit
COPY services/storage-service ./services/storage-service
RUN mkdir -p /data /workspace/services/storage-service/data \
    && chown -R node:node /data /workspace/services/storage-service/data \
    && chmod +x /workspace/services/storage-service/docker-entrypoint.sh
WORKDIR /workspace/services/storage-service
USER node
EXPOSE 3003
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "const p=process.env.STORAGE_PORT||process.env.PORT||3003;fetch('http://127.0.0.1:'+p+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
