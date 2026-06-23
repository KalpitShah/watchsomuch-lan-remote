# WatchSoMuch LAN Remote — relay server
# Zero-dependency Node app, so the image is tiny and builds instantly.
FROM node:20-alpine

# Run as the unprivileged user that ships with the node image.
WORKDIR /app

# Copy the whole server (no npm install needed — there are no dependencies).
COPY . .

# The relay listens on 3000 (see index.js).
EXPOSE 3000

USER node

CMD ["node", "index.js"]
