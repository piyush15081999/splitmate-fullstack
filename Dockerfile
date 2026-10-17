FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV CHECKPOINT_DISABLE=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run db:generate

FROM dependencies AS verification
CMD ["sh", "-c", "npm run typecheck && npm test && npm run build"]

FROM dependencies AS backend
RUN npm run build -w @splitmate/backend
EXPOSE 3001
CMD ["sh", "-c", "npm run db:deploy && npm run start -w @splitmate/backend"]

FROM dependencies AS frontend
RUN npm run build -w @splitmate/frontend
EXPOSE 5173
CMD ["npm", "run", "dev", "-w", "@splitmate/frontend", "--", "--host", "0.0.0.0"]

# Local browser verification only; not part of application runtime images.
FROM verification AS e2e
RUN npm exec -- playwright install --with-deps chromium
