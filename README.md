# Google Search Console MCP Server

MCP (Model Context Protocol) server for Google Search Console API. Enables Claude to query GSC data automatically.

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Server
```bash
npm start
```

Server will start on `http://localhost:3000`
- MCP endpoint: `http://localhost:3000/mcp`
- Health check: `http://localhost:3000/health`

### 3. Deploy to Replit (Recommended)

1. Fork/import this repo into Replit
2. Click "Run" button
3. Copy the public URL (e.g., `https://[project].replit.dev`)
4. In Claude.ai:
   - Settings → Connectors → Add Custom Connector
   - Name: "Google Search Console"
   - Remote MCP server URL: `https://[project].replit.dev/mcp`
   - Save & Connect
5. Authorize your Google account when prompted

## Available Tools

### `get_search_analytics`
Query Search Console performance data for a date range.

**Parameters:**
- `siteUrl`: Site URL (e.g., `sc-domain:gogolfvietnam.com`)
- `startDate`: YYYY-MM-DD format
- `endDate`: YYYY-MM-DD format
- `dimensions`: Array of dimensions to group by (query, page, country, device)
- `rowLimit`: Max rows to return (default: 25000)

### `get_sites`
List all verified sites in your Search Console account.

### `set_access_token`
Set OAuth2 access token (called automatically by Claude after authorization).

## Environment

No environment variables required. OAuth2 tokens are managed by Claude.ai.

## License

MIT
