FROM node:18-alpine

# Install tsx globally to run TypeScript directly
RUN npm install -g tsx@4.19.2

WORKDIR /workspace

# Copy MCP servers source code and install dependencies
COPY mcp /workspace/mcp
RUN for dir in /workspace/mcp/*/; do \
      if [ -f "${dir}package.json" ]; then \
        echo "Installing dependencies in $dir" && \
        npm --prefix "$dir" ci --legacy-peer-deps; \
      fi; \
    done

# Copy agents source code and install dependencies
COPY ai-agents/package*.json ./
RUN npm ci --legacy-peer-deps

COPY ai-agents/src ./src

# The agent will be started via docker-compose command override
CMD ["sh"]
