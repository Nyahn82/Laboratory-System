FROM node:24-alpine AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY packages/service-kit/package.json packages/service-kit/package.json
COPY services/verification-service/package.json services/verification-service/package.json
RUN npm ci --workspace @rhu-labchain/verification-service --include-workspace-root=false

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=dependencies /workspace/node_modules ./node_modules
COPY packages/service-kit ./packages/service-kit
COPY services/verification-service ./services/verification-service
RUN mkdir -p /data /workspace/services/verification-service/data \
    && chown -R node:node /data /workspace/services/verification-service/data \
    && chmod +x /workspace/services/verification-service/docker-entrypoint.sh
WORKDIR /workspace/services/verification-service
USER node
EXPOSE 3004
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "const p=process.env.VERIFICATION_PORT||process.env.PORT||3004;fetch('http://127.0.0.1:'+p+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
