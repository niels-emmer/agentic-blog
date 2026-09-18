FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
ENV NODE_ENV=production
USER node
EXPOSE 3456
CMD ["node", "src/index.js"]