FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/logger ./packages/logger
COPY packages/eslint-config ./packages/eslint-config
COPY apps/productivity-service ./apps/productivity-service
RUN pnpm install --frozen-lockfile=false --filter @lifehelper/productivity-service...
RUN pnpm --filter @lifehelper/logger build && pnpm --filter @lifehelper/productivity-service prisma:generate && pnpm --filter @lifehelper/productivity-service build && cp -r apps/productivity-service/dist /service-dist
RUN pnpm --filter @lifehelper/productivity-service deploy --prod /prod
FROM node:22-alpine AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /prod ./
COPY --from=builder /service-dist ./dist
EXPOSE 3002
CMD ["node","dist/main.js"]
