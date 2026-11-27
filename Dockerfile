# Kana Dojo on Cloud Run, keeping accounts and progress in Firestore.
# tools/deploy.sh builds this from a release tag (so the image holds exactly that release).
FROM node:22-slim
ENV NODE_ENV=production KANA_STORE=firestore TRUST_PROXY=1
WORKDIR /app
COPY package.json index.html icon.png ./
COPY css css
COPY js js
COPY data data
COPY server server
USER node
# Cloud Run sets PORT.
CMD ["node", "server/server.js"]
