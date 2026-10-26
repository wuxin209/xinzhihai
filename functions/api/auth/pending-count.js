// 待审批数量接口
import { getAccounts, corsHeaders } from '../_config.js';
import { authenticateLite } from '../../_lib.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  try {
    const auth = await authenticateLite(context.request, context.env);
    if (!auth) return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: corsHeaders });
    
    const { accounts } = await getAccounts(context.env);
    // super_admin看所有pending，普通主账号看自己名下的pending
    let pending = accounts.filter(a => a.status === 'pending');
    if (auth.role !== 'super_admin') {
      pending = pending.filter(a => !a.parentUsername || a.parentUsername === auth.username);
    }
    
    return new Response(JSON.stringify({ count: pending.length, accounts: pending.map(a => ({ username: a.username, nickname: a.nickname, createdAt: a.createdAt })) }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}
