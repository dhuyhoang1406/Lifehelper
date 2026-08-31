FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/logger ./packages/logger
COPY packages/shared-types ./packages/shared-types
COPY packages/eslint-config ./packages/eslint-config
COPY apps/notification-service ./apps/notification-service
RUN pnpm install --frozen-lockfile --filter @lifehelper/notification-service...
RUN pnpm --filter @lifehelper/logger build && pnpm --filter @lifehelper/shared-types build && pnpm --filter @lifehelper/notification-service prisma:generate && pnpm --filter @lifehelper/notification-service build && cp -r apps/notification-service/dist /service-dist && cp -r apps/notification-service/generated /service-generated
RUN pnpm --filter @lifehelper/notification-service deploy --prod /prod
FROM node:22-alpine AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /prod ./
COPY --from=builder /service-dist ./dist
COPY --from=builder /service-generated ./generated
EXPOSE 3005
CMD ["node","dist/main.js"]
