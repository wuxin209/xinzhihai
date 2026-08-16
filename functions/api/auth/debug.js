import { getAccounts, getGithubToken, corsHeaders } from '../_config.js';

export async function onRequestGet(context) {
  const token = getGithubToken(context.env);
  const result = await getAccounts(context.env);
  return new Response(JSON.stringify({
    tokenLength: token.length,
    tokenPrefix: token.substring(0, 4),
    accountsCount: result.accounts.length,
    accounts: result.accounts.map(a => a.username),
    error: result.error || null
  }), { headers: corsHeaders });
}
