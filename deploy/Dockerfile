# rscalc in a container.
#
# One stage on purpose: the server *runs the refresh pipeline*, so the image needs
# the TypeScript tooling (tsx), the scripts, `src/` and the dev dependencies that
# `pnpm refresh` uses. A slim runtime stage would only work if it also kept all of
# that, so splitting it would be theatre.
#
# The data directory is committed with the repo, so a fresh image has something to
# serve before the first refresh finishes.
FROM node:22-bookworm

WORKDIR /app
RUN corepack enable

# Dependencies first: this layer is cached until the lockfile changes.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# The bundle no longer contains the data (the server publishes it), so this is a
# small, fast build.
RUN pnpm build

RUN chown -R node:node /app
USER node

ENV RSCALC_ADDR=:8080
ENV RSCALC_REPO_DIR=/app
# Mount a volume here to keep published datasets across restarts.
ENV RSCALC_RUNTIME_DIR=/app/runtime

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.RSCALC_ADDR||':8080').split(':').pop()+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "serve"]
