import { requestUrl, type RequestUrlResponse } from 'obsidian';

export interface SourceFile {
  source_id: number;
  folder: string;
  file_name: string;
  markdown: string;
}

export interface FirstExport extends SourceFile {
  first_export: true;
  highlight_ids: number[];
}

export interface Append {
  source_id: number;
  folder: string;
  file_name: string;
  first_export: false;
  highlight_ids: number[];
  heading: string;
  bullets: string;
  exported_at: string;
}

export type PendingSource = FirstExport | Append;

export interface PendingPage {
  has_more: boolean;
  sources: PendingSource[];
}

export type TokenPoll =
  | { kind: 'pending' }
  | { kind: 'token'; token: string }
  | { kind: 'expired' }
  | { kind: 'rejected' };

export type ApiErrorKind = 'unauthorized' | 'paused' | 'busy' | 'not_found' | 'failed';

const ERROR_KINDS: Record<number, ApiErrorKind> = {
  401: 'unauthorized',
  403: 'paused',
  404: 'not_found',
  409: 'busy',
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;

  constructor(readonly status: number) {
    super(`Becoming answered ${status}`);
    this.kind = ERROR_KINDS[status] ?? 'failed';
  }
}

export interface ApiConfig {
  apiBaseUrl: string;
  token: string | null;
}

export class BecomingApi {
  constructor(private readonly config: ApiConfig) {}

  // 429 and 5xx keep the poll going: the code stays valid for ten minutes.
  async exchangeCode(code: string): Promise<TokenPoll> {
    const response = await this.send('POST', '/exports/obsidian/tokens', { code });
    const { status } = response;
    if (status === 201) return { kind: 'token', token: response.json.token };
    if (status === 410) return { kind: 'expired' };
    if (status === 202 || status === 429 || status >= 500) return { kind: 'pending' };
    return { kind: 'rejected' };
  }

  async pending(): Promise<PendingPage> {
    return (await this.call('GET', '/exports/obsidian/pending')).json;
  }

  async ack(ids: number[], lastPage: boolean): Promise<void> {
    await this.call('POST', '/exports/obsidian/acks', { user_highlight_ids: ids, last_page: lastPage });
  }

  async source(id: number): Promise<SourceFile | null> {
    try {
      return (await this.call('GET', `/exports/obsidian/sources/${id}`)).json;
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'not_found') return null;
      throw error;
    }
  }

  async reset(): Promise<void> {
    await this.call('POST', '/exports/obsidian/resets');
  }

  private async call(method: string, path: string, body?: object): Promise<RequestUrlResponse> {
    const response = await this.send(method, path, body, this.config.token);
    if (response.status < 200 || response.status >= 300) throw new ApiError(response.status);
    return response;
  }

  private send(method: string, path: string, body?: object, token?: string | null) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return requestUrl({
      url: `${this.config.apiBaseUrl.replace(/\/+$/, '')}${path}`,
      method,
      headers,
      contentType: body ? 'application/json' : undefined,
      body: body ? JSON.stringify(body) : undefined,
      throw: false,
    });
  }
}
