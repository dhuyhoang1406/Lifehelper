FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/logger ./packages/logger
COPY packages/eslint-config ./packages/eslint-config
COPY apps/analytics-service ./apps/analytics-service
RUN pnpm install --frozen-lockfile --filter @lifehelper/analytics-service...
RUN pnpm --filter @lifehelper/logger build && pnpm --filter @lifehelper/analytics-service prisma:generate && pnpm --filter @lifehelper/analytics-service build && cp -r apps/analytics-service/dist /service-dist
RUN pnpm --filter @lifehelper/analytics-service deploy --prod /prod
FROM node:22-alpine AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /prod ./
COPY --from=builder /service-dist ./dist
EXPOSE 3006
CMD ["node","dist/main.js"]
