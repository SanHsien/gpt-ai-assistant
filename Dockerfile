FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node . .
USER node

CMD ["npm", "start"]
