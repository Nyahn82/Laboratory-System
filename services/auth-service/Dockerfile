FROM node:24-alpine AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY services/auth-service/package.json services/auth-service/package.json
RUN npm ci --workspace @rhu-labchain/auth-service --include-workspace-root=false --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    DATA_ROOT=/data
WORKDIR /workspace
COPY --from=dependencies /workspace/node_modules ./node_modules
COPY services/auth-service/package.json ./services/auth-service/package.json
COPY services/auth-service/src ./services/auth-service/src
COPY services/auth-service/scripts ./services/auth-service/scripts
COPY services/auth-service/migrations ./services/auth-service/migrations
RUN mkdir -p /data/auth && chown -R node:node /data
WORKDIR /workspace/services/auth-service
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/migrate.js && exec node src/server.js"]
