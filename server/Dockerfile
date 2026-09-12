FROM node:24-alpine AS build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --no-audit --no-fund
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/server/dist ./dist
COPY database /app/database
EXPOSE 5000
HEALTHCHECK --interval=10s --timeout=5s --retries=10 CMD node -e "fetch('http://127.0.0.1:5000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
