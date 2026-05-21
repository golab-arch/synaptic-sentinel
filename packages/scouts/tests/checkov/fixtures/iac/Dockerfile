# Fixture deliberadamente mal configurada - NO es codigo de produccion.
# Dispara varios checks de Checkov para Dockerfile (corre como root, sin
# HEALTHCHECK, etc.).
FROM node:20
COPY . /app
RUN npm install
CMD ["node", "/app/index.js"]
