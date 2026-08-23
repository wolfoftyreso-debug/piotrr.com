# One deployable container (ECS Fargate / App Runner) per Section 3
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
# The `node` user ships with the image (uid 1000). Running the build as
# it matters because this stage is not only a build stage: the migration
# Job runs from it, so `k8s` was executing drizzle-kit as root against
# the production database. HOME must move too — npm writes a cache there
# and /root is not writable by uid 1000.
ENV HOME=/tmp NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN chown -R node:node /app
USER node
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next installs its own SIGTERM/SIGINT handlers and exits immediately.
# Measured: with them in place our drain logged that it had started and
# the process was gone before it finished — jobs cut off mid-flight on
# every rolling deploy, while the code looked correct. This hands signal
# handling to src/lib/lifecycle.ts, which is the only reason the drain
# runs at all.
ENV NEXT_MANUAL_SIG_HANDLE=true
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Remove the package managers from the runtime image.
#
# The container runs `node server.js`; it never invokes npm, npx or
# corepack. Shipping them anyway costs us twice. They are attack surface
# — a package manager is a ready-made install-and-exfiltrate tool for
# anyone who gets code execution in here. And npm was the source of
# essentially every finding the container scan reported: it vendors its
# own copies of tar, sigstore, ip-address and brace-expansion, and those
# copies carry CVEs that `npm audit --omit=dev` cannot see, because they
# are not in our dependency tree at all. Verified: none of the reported
# packages is in the production tree, and the one that is (picomatch) is
# 4.0.5 here, above the fixed version, and is not in the standalone
# bundle.
#
# corepack and yarn go for the same reason rather than a current CVE:
# both are clean today, and neither has any more business in a production
# container than npm does. The base image ships three package managers —
# npm, corepack and a bundled yarn 1.x under /opt — and the runtime
# invokes none of them. Removing them on the principle is cheaper than
# revisiting it the first time one appears in a scan, and leaving one
# behind while deleting the others would be arbitrary.
#
# Deleting them removes the vulnerable code rather than suppressing the
# report. The migrate image is unaffected: it uses the `build` stage,
# which needs npm to run drizzle-kit.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/corepack \
           /opt/yarn-* \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg

USER app
EXPOSE 3000
CMD ["node", "server.js"]
