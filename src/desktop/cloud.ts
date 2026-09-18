import type { Run, Workflow } from '../shared/types';
export type CloudSession = {
  token: string;
  user: { id: string; email: string };
  workspace: { id: string; name: string; role: string };
};
export class RelayCloudClient {
  constructor(
    private readonly baseUrl: string,
    private token = '',
  ) {
    const url = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Cloud API URL must be a clean HTTP(S) origin.');
  }
  setToken(token: string) {
    this.token = token;
  }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };
    if (init.body != null) headers['Content-Type'] = 'application/json';
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      redirect: 'error',
      headers,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        typeof body?.message === 'string'
          ? body.message
          : `Relay Cloud returned HTTP ${response.status}.`,
      );
    return body as T;
  }
  health() {
    return this.request<{ ok: boolean }>('/health');
  }
  async register(email: string, password: string) {
    const session = await this.request<CloudSession>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.token = session.token;
    return session;
  }
  async login(email: string, password: string) {
    const session = await this.request<CloudSession>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.token = session.token;
    return session;
  }
  workflows(workspaceId: string) {
    return this.request<{ workflow: Workflow; version: number }[]>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/workflows`,
    );
  }
  saveWorkflow(workspaceId: string, workflow: Workflow) {
    return this.request<{ workflow: Workflow; version: number }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/workflows`,
      { method: 'POST', body: JSON.stringify({ workflow }) },
    );
  }
  shareWorkflow(workspaceId: string, workflowId: string) {
    return this.request<{ token: string; url: string }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/workflows/${encodeURIComponent(workflowId)}/share`,
      { method: 'POST' },
    );
  }
  recordRun(
    workspaceId: string,
    run: Pick<
      Run,
      | 'id'
      | 'workflowId'
      | 'status'
      | 'source'
      | 'preview'
      | 'startedAt'
      | 'finishedAt'
      | 'error'
      | 'workflow'
    > & { summary?: string },
  ) {
    return this.request(`/api/workspaces/${encodeURIComponent(workspaceId)}/runs`, {
      method: 'POST',
      body: JSON.stringify({
        id: run.id,
        workflowId: run.workflowId,
        status:
          run.status === 'success' ||
          run.status === 'failed' ||
          run.status === 'cancelled' ||
          run.status === 'interrupted'
            ? run.status
            : 'interrupted',
        mode: run.preview ? 'local' : 'local',
        sourceName: run.source.split(/[\\/]/).pop() || 'Local file',
        summary: run.summary || `Visited ${run.workflow.nodes.length} configured steps.`,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        error: run.error,
      }),
    });
  }
}
