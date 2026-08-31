FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/logger ./packages/logger
COPY packages/shared-types ./packages/shared-types
COPY packages/eslint-config ./packages/eslint-config
COPY apps/ai-service ./apps/ai-service
RUN pnpm install --frozen-lockfile --filter @lifehelper/ai-service...
RUN pnpm --filter @lifehelper/logger build && pnpm --filter @lifehelper/shared-types build && pnpm --filter @lifehelper/ai-service prisma:generate && pnpm --filter @lifehelper/ai-service build && cp -r apps/ai-service/dist /service-dist && cp -r apps/ai-service/generated /service-generated
RUN pnpm --filter @lifehelper/ai-service deploy --prod /prod
FROM node:22-alpine AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /prod ./
COPY --from=builder /service-dist ./dist
COPY --from=builder /service-generated ./generated
EXPOSE 3003
CMD ["node","dist/main.js"]
