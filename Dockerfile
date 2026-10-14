FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    APP_PORT=3000

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node tools/apply-dev-dependency-guards.cjs ./tools/
COPY --chown=node:node tools/dependency-guards/ ./tools/dependency-guards/
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node . .
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.APP_PORT || '3000') + '/health/live', { signal: AbortSignal.timeout(4000) }).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
