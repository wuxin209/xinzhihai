// 子账号改密（服务端真实同步） - 前端 TeamManagementPage 重置密码走此接口
// 正式站账号以 username 为键，[id] 接收 username（前端列表 id 字段即 username）
import { getAccounts, saveAccounts, hashPassword, corsHeaders } from '../../../_config.js';
import { authenticateLite } from '../../../../_lib.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  try {
    const auth = await authenticateLite(context.request, context.env);
    if (!auth) return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: corsHeaders });
    if (auth.role !== 'super_admin') return new Response(JSON.stringify({ error: '无权限' }), { status: 403, headers: corsHeaders });

    const targetId = decodeURIComponent(context.params.id || '');
    const body = await context.request.json().catch(() => ({}));
    const newPassword = body.password || body.newPassword;
    if (!newPassword || String(newPassword).length < 4) {
      return new Response(JSON.stringify({ error: '新密码长度不能少于 4 位' }), { status: 400, headers: corsHeaders });
    }

    const { accounts, sha } = await getAccounts(context.env);
    // 兼容：id 字段即 username；也支持直接用 username 匹配
    const acc = accounts.find(a => (a.id && String(a.id) === String(targetId)) || a.username === targetId);
    if (!acc) return new Response(JSON.stringify({ error: '账号不存在' }), { status: 404, headers: corsHeaders });
    if (acc.username === 'wuxin209') return new Response(JSON.stringify({ error: '不能修改主账号密码' }), { status: 400, headers: corsHeaders });

    acc.passwordHash = await hashPassword(String(newPassword));
    const saved = await saveAccounts(context.env, accounts, sha);
    if (!saved) {
      return new Response(JSON.stringify({ error: '服务端保存失败，请稍后重试' }), { status: 502, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ success: true, username: acc.username, message: '密码已更新' }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}
