import { handleOAuthRequest, type OAuthEnvironment } from '@mandate/mcp-server/oauth';

interface OAuthRequestContext {
  readonly request: Request;
  readonly env: OAuthEnvironment;
}

export function onRequest(context: OAuthRequestContext): Promise<Response> {
  return handleOAuthRequest(context.request, context.env);
}
