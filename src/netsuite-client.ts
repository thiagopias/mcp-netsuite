import jwt from "jsonwebtoken";

interface NetSuiteConfig {
  accountId: string;
  clientId: string;
  certificateId: string;
  privateKey: string;
}

interface SuiteQLResponse {
  links: unknown[];
  count: number;
  hasMore: boolean;
  offset: number;
  totalResults: number;
  items: Record<string, unknown>[];
}

interface RestletResponse {
  status: number;
  body: unknown;
}

export class NetSuiteClient {
  private config: NetSuiteConfig;
  private accessToken: { token: string; expiresAt: number } | null = null;

  private accountIdForUrl: string;

  constructor(config: NetSuiteConfig) {
    this.config = config;
    this.accountIdForUrl = config.accountId.replace(/_/g, "-").toLowerCase();
  }

  private get baseUrl(): string {
    return `https://${this.accountIdForUrl}.suitetalk.api.netsuite.com`;
  }

  private get tokenEndpoint(): string {
    return `${this.baseUrl}/services/rest/auth/oauth2/v1/token`;
  }

  private get suiteqlEndpoint(): string {
    return `${this.baseUrl}/services/rest/query/v1/suiteql`;
  }

  private buildClientAssertion(): string {
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: this.config.clientId,
      scope: ["restlets", "rest_webservices"],
      aud: this.tokenEndpoint,
      iat: now,
      exp: now + 3600,
    };

    const header = {
      typ: "JWT" as const,
      alg: "PS256" as jwt.Algorithm,
      kid: this.config.certificateId,
    };

    return jwt.sign(payload, this.config.privateKey, {
      algorithm: "PS256",
      header,
    });
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.expiresAt - 60_000) {
      return this.accessToken.token;
    }

    const clientAssertion = this.buildClientAssertion();

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: clientAssertion,
    });

    const response = await fetch(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OAuth token request failed (${response.status}): ${errorText}`
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    this.accessToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return this.accessToken.token;
  }

  /** Parse a NetSuite API error response into a readable message. */
  private async parseErrorResponse(response: Response): Promise<string> {
    const text = await response.text();
    try {
      const json = JSON.parse(text) as {
        title?: string;
        "o:errorDetails"?: Array<{ detail?: string; "o:errorCode"?: string }>;
      };
      const details = json["o:errorDetails"];
      if (Array.isArray(details) && details.length > 0) {
        const msgs = details.map((d) => d.detail).filter(Boolean);
        if (msgs.length > 0) return `${msgs.join("; ")}`;
      }
      if (json.title) return json.title;
    } catch {
      // not JSON — return raw text
    }
    return text;
  }

  async runSuiteQL(
    query: string,
    limit: number = 1000,
    offset: number = 0
  ): Promise<SuiteQLResponse> {
    const token = await this.authenticate();
    const url = `${this.suiteqlEndpoint}?limit=${limit}&offset=${offset}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "transient",
      },
      body: JSON.stringify({ q: query }),
    });

    if (!response.ok) {
      const detail = await this.parseErrorResponse(response);
      throw new Error(`SuiteQL query failed (${response.status}): ${detail}`);
    }

    return (await response.json()) as SuiteQLResponse;
  }

  async runSuiteQLAll(query: string, pageSize: number = 1000): Promise<{
    items: Record<string, unknown>[];
    totalResults: number;
    pagesFetched: number;
  }> {
    const allItems: Record<string, unknown>[] = [];
    let offset = 0;
    let totalResults = 0;
    let pagesFetched = 0;

    while (true) {
      const page = await this.runSuiteQL(query, pageSize, offset);
      totalResults = page.totalResults;
      pagesFetched++;
      allItems.push(...page.items);

      if (!page.hasMore || allItems.length >= totalResults) break;
      offset += pageSize;
    }

    return { items: allItems, totalResults, pagesFetched };
  }

  async getRecordMetadata(recordType: string): Promise<unknown> {
    const token = await this.authenticate();
    const url = `${this.baseUrl}/services/rest/record/v1/metadata-catalog/${encodeURIComponent(recordType)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/schema+json",
      },
    });

    if (!response.ok) {
      const detail = await this.parseErrorResponse(response);
      throw new Error(`Metadata catalog request failed (${response.status}): ${detail}`);
    }

    return await response.json();
  }

  async getRecord(
    recordType: string,
    id: string | number,
    expandSubResources = false
  ): Promise<unknown> {
    const token = await this.authenticate();
    const params = expandSubResources ? "?expandSubResources=true" : "";
    const url =
      `${this.baseUrl}/services/rest/record/v1/${encodeURIComponent(recordType)}` +
      `/${encodeURIComponent(String(id))}${params}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const detail = await this.parseErrorResponse(response);
      throw new Error(`Record fetch failed (${response.status}): ${detail}`);
    }

    return await response.json();
  }

  async createRecord(
    recordType: string,
    body: Record<string, unknown>
  ): Promise<{ id: string | null; location: string | null; status: number }> {
    const token = await this.authenticate();
    const url = `${this.baseUrl}/services/rest/record/v1/${encodeURIComponent(recordType)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await this.parseErrorResponse(response);
      throw new Error(`Record create failed (${response.status}): ${detail}`);
    }

    const location = response.headers.get("location");
    let id: string | null = null;
    if (location) {
      const match = location.match(/\/([^/]+)\/?$/);
      if (match) id = match[1];
    }
    return { id, location, status: response.status };
  }

  async callRestlet(
    scriptId: string,
    deployId: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    body?: unknown
  ): Promise<RestletResponse> {
    const token = await this.authenticate();

    const url =
      `https://${this.accountIdForUrl}.restlets.api.netsuite.com/app/site/hosting/restlet.nl` +
      `?script=${scriptId}&deploy=${deployId}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const options: RequestInit = { method, headers };
    if (body && (method === "POST" || method === "PUT")) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    const responseBody = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseBody);
    } catch {
      parsed = responseBody;
    }

    return { status: response.status, body: parsed };
  }
}
