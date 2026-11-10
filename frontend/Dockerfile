FROM node:22-slim AS build

WORKDIR /app
RUN corepack enable

# Install dependencies first (cached across source changes).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# Baked into the static bundle; fine for a local, single-user tool.
ARG VITE_API_TOKEN=dev-token
ENV VITE_API_TOKEN=$VITE_API_TOKEN
RUN pnpm build


FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -q --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
