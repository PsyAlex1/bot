# Dockerfile pour Railway/Render
FROM node:18-alpine
WORKDIR /app
COPY package.json .
COPY .env.example .env
RUN npm install
COPY . .
CMD ["npm", "start"]
