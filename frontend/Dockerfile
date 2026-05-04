FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Build with production API URL injected at build time
ARG VITE_API_URL=http://localhost:8000
ARG VITE_API_SECRET_TOKEN
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_SECRET_TOKEN=$VITE_API_SECRET_TOKEN
RUN npm run build

# Serve with nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
