#!/usr/bin/env node

const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const { readFileSync } = require('fs');

// ============================================
// Google Search Console MCP Server
// ============================================

// Initialize Google API client
const searchconsole = google.webmasters('v3');

// Scopes required to read Search Console data.
const GSC_SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

// Optional manual OAuth2 access token (fallback / testing only).
let accessToken;

// Lazily-built service-account auth client (preferred, durable auth).
let serviceAccountAuth = null;

/**
 * Build (once) and return a Google auth client from the service account JSON
 * stored in the GOOGLE_SERVICE_ACCOUNT_JSON environment variable.
 * Returns null if the env var is not set or cannot be parsed.
 */
function getServiceAccountAuth() {
  if (serviceAccountAuth) return serviceAccountAuth;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (e) {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON:', e.message);
    return null;
  }

  // Env-var storage often escapes newlines in the private key; normalize them.
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  }

  serviceAccountAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: GSC_SCOPES,
  });

  return serviceAccountAuth;
}

/**
 * Resolve the auth client to use for a request.
 * Priority: a manually-set access token (if any) → the service account.
 * Returns null if neither is available.
 */
function resolveAuth() {
  if (accessToken) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return auth;
  }
  return getServiceAccountAuth();
}

const NO_AUTH_ERROR = {
  error:
    'No credentials available. Set GOOGLE_SERVICE_ACCOUNT_JSON (a Google ' +
    'service-account key that has been granted access in Search Console), ' +
    'or call set_access_token with a valid Google OAuth2 access token.',
};

// ============================================
// Tool Definitions
// ============================================

const tools = [
  {
    name: 'get_search_analytics',
    description: 'Get Search Console performance data (clicks, impressions, CTR, position) for a date range',
    inputSchema: {
      type: 'object',
      properties: {
        siteUrl: {
          type: 'string',
          description: 'Site URL (e.g., sc-domain:gogolfvietnam.com or https://gogolfvietnam.com/)'
        },
        startDate: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format'
        },
        endDate: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format'
        },
        dimensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Dimensions to group by (query, page, country, device, etc.)'
        },
        rowLimit: {
          type: 'number',
          description: 'Number of rows to return (default: 25000)'
        }
      },
      required: ['siteUrl', 'startDate', 'endDate']
    }
  },
  {
    name: 'get_sites',
    description: 'List all verified sites in Search Console',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'set_access_token',
    description: 'Optional: manually set an OAuth2 access token for Google Search Console API. Not needed when GOOGLE_SERVICE_ACCOUNT_JSON is configured.',
    inputSchema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'Google OAuth2 access token'
        }
      },
      required: ['token']
    }
  }
];

// ============================================
// Tool Implementations
// ============================================

async function getSearchAnalytics(siteUrl, startDate, endDate, dimensions = ['query'], rowLimit = 25000) {
  const auth = resolveAuth();
  if (!auth) {
    return NO_AUTH_ERROR;
  }

  try {
    const response = await searchconsole.searchanalytics.query({
      siteUrl: siteUrl,
      requestBody: {
        startDate: startDate,
        endDate: endDate,
        dimensions: dimensions,
        rowLimit: rowLimit
      },
      auth: auth
    });

    return {
      success: true,
      data: response.data.rows || [],
      siteUrl: siteUrl,
      dateRange: { startDate, endDate },
      dimensionsUsed: dimensions
    };
  } catch (error) {
    return {
      error: `Failed to fetch search analytics: ${error.message}`,
      details: error.toString()
    };
  }
}

async function getSites() {
  const auth = resolveAuth();
  if (!auth) {
    return NO_AUTH_ERROR;
  }

  try {
    const response = await searchconsole.sites.list({
      auth: auth
    });

    return {
      success: true,
      sites: response.data.siteEntry || []
    };
  } catch (error) {
    return {
      error: `Failed to fetch sites: ${error.message}`,
      details: error.toString()
    };
  }
}

function setAccessToken(token) {
  accessToken = token;
  return {
    success: true,
    message: 'Access token set successfully'
  };
}

// ============================================
// MCP Protocol Handler
// ============================================

async function handleRequest(requestBody) {
  const { jsonrpc, id, method, params } = requestBody;

  // Initialize response
  const response = {
    jsonrpc: '2.0',
    id: id
  };

  try {
    if (method === 'initialize') {
      response.result = {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: {
          name: 'Google Search Console MCP Server',
          version: '1.1.0'
        }
      };
    } else if (method === 'resources/list') {
      response.result = {
        resources: []
      };
    } else if (method === 'tools/list') {
      response.result = {
        tools: tools
      };
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params;

      let result;
      if (name === 'set_access_token') {
        result = setAccessToken(args.token);
      } else if (name === 'get_sites') {
        result = await getSites();
      } else if (name === 'get_search_analytics') {
        result = await getSearchAnalytics(
          args.siteUrl,
          args.startDate,
          args.endDate,
          args.dimensions || ['query'],
          args.rowLimit || 25000
        );
      } else {
        response.error = {
          code: -32601,
          message: `Unknown tool: ${name}`
        };
        return response;
      }

      response.result = result;
    } else {
      response.error = {
        code: -32601,
        message: `Unknown method: ${method}`
      };
    }
  } catch (error) {
    response.error = {
      code: -32603,
      message: `Internal error: ${error.message}`
    };
  }

  return response;
}

// ============================================
// HTTP Server
// ============================================

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/mcp' && req.method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const requestBody = JSON.parse(body);
        const response = await handleRequest(requestBody);
        res.writeHead(200);
        res.end(JSON.stringify(response));
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'Parse error'
          }
        }));
      }
    });
  } else if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      auth: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? 'service_account' : (accessToken ? 'access_token' : 'none')
    }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// ============================================
// Start Server
// ============================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Google Search Console MCP Server running on port ${PORT}`);
  console.log(`MCP Endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Health Check: http://localhost:${PORT}/health`);
  console.log(`Auth mode: ${process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? 'service_account (GOOGLE_SERVICE_ACCOUNT_JSON detected)' : 'none set yet'}`);
});

module.exports = { handleRequest };
